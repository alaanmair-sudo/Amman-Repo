"""CLI: read a DWF/DWG/DXF building drawing, compute per-edge setbacks to lot.

Pipeline:
  1. If DWF: convert to DWG via configured commercial converter
  2. Open the DWG in AutoCAD LT 2024+ via autocad-mcp
  3. Extract polylines on the `building` and `lot` layers via execute_lisp
  4. Build shapely polygons, compute nearest-lot-edge distance per building edge
  5. (Optional) If --site-plan PDF given: extract required setbacks, classify
     lot edges via STREET layer, compute violations + fine
  6. Emit: text JSON, markdown report, annotated DWG (and optional PDF)
"""

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import sys
from pathlib import Path

import yaml

from app.site_plan_extractor import extract_site_plan_data
from app.special_provisions import apply_special_provisions
from dwf_convert import DWFConversionError, normalize_to_dwg
from geometry import (
    ComplianceResult,
    SetbackPair,
    compute_setbacks,
    compute_violations,
    polylines_to_polygon,
)
from mcp_client import AutoCADMCPClient, Polyline, connect_autocad_mcp
from report import render_json, render_markdown
from street_classifier import classify_edges


def load_config(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(
            f"Config file {path} not found. Copy config.yaml.example to config.yaml and edit."
        )
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def resolve_layer_name(available: list[dict], preferred: str, case_insensitive: bool) -> str:
    names = [l.get("name") if isinstance(l, dict) else str(l) for l in available]
    if preferred in names:
        return preferred
    if case_insensitive:
        for n in names:
            if n and n.lower() == preferred.lower():
                return n
    raise SystemExit(
        f"Layer '{preferred}' not found. Available: {', '.join(n for n in names if n)}"
    )


def find_layer_name(available: list[dict], preferred: str, case_insensitive: bool) -> str | None:
    """Like resolve_layer_name but returns None instead of raising — used for
    optional layers (STREET, SETBACK_VIOLATION) where absence is not fatal."""
    names = [l.get("name") if isinstance(l, dict) else str(l) for l in available]
    if preferred in names:
        return preferred
    if case_insensitive:
        for n in names:
            if n and n.lower() == preferred.lower():
                return n
    return None


async def _annotate_compliance(
    mcp: AutoCADMCPClient,
    compliance: ComplianceResult,
    layer_name: str,
    envelope_color: str,
    violation_color: str,
    hatch_pattern: str,
    hatch_scale: float,
    envelope_linetype: str,
) -> None:
    """Bake the buildable envelope (dashed) and the hatched violation polygons
    onto a single SETBACK_VIOLATION layer in the open drawing.

    Order matters:
      1. Ensure layer + load+set linetype (so the polyline picks it up)
      2. Draw envelope polylines (dashed)
      3. Switch to a non-dashed sub-layer for hatch boundaries (hatches inherit
         the layer's linetype only for boundary polylines, not the hatch fill;
         we keep them on the same layer for simplicity)
      4. Hatch each violation polygon
    """
    from shapely.geometry import MultiPolygon, Polygon  # local import to avoid CLI import cost

    await mcp.ensure_layer(layer_name, color=envelope_color)
    await mcp.load_linetype(envelope_linetype)
    await mcp.set_layer_linetype(layer_name, envelope_linetype)
    await mcp.set_current_layer(layer_name)

    def _ring_lists(geom) -> list[list[tuple[float, float]]]:
        if geom is None or geom.is_empty:
            return []
        polys: list[Polygon]
        if isinstance(geom, Polygon):
            polys = [geom]
        elif isinstance(geom, MultiPolygon):
            polys = list(geom.geoms)
        else:
            polys = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]
        rings: list[list[tuple[float, float]]] = []
        for p in polys:
            rings.append([(float(x), float(y)) for x, y in p.exterior.coords])
            for ring in p.interiors:
                rings.append([(float(x), float(y)) for x, y in ring.coords])
        return rings

    # Dashed envelope outline.
    for ring in _ring_lists(compliance.envelope):
        await mcp.draw_polyline(ring, closed=True, layer=layer_name)

    # Hatch the violation polygons. The hatch entity is drawn on the layer
    # with the chosen pattern; the helper polylines used as boundaries are
    # deleted by the LISP after the hatch is created.
    violation_rings = _ring_lists(compliance.total_violation)
    if violation_rings:
        await mcp.hatch_polygon(
            rings=violation_rings,
            layer=layer_name,
            pattern=hatch_pattern,
            scale=hatch_scale,
        )

    # If there's a serious lot-crossing, hatch it with a denser pattern so it
    # stands out from the regular violation hatch.
    if compliance.is_serious and compliance.lot_crossing is not None:
        crossing_rings = _ring_lists(compliance.lot_crossing)
        if crossing_rings:
            await mcp.hatch_polygon(
                rings=crossing_rings,
                layer=layer_name,
                pattern=hatch_pattern,
                scale=hatch_scale * 0.5,  # denser — makes it visually heavier
            )


async def run(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    mcp_cfg = cfg.get("autocad_mcp", {})
    layer_cfg = cfg.get("layers", {})
    dwf_cfg = cfg.get("dwf_converter", {})
    out_cfg = cfg.get("output", {})
    compliance_cfg = cfg.get("compliance", {})

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    # ---- Site plan PDF (optional) — extract BEFORE opening AutoCAD so we can
    # fail fast on a wrong/unparseable PDF and skip the AutoCAD spin-up cost
    # if the user passed --site-plan but it's broken.
    site_plan_data: dict | None = None
    compliance_unavailable_reason: str | None = None
    if args.site_plan:
        site_plan_path = Path(args.site_plan).resolve()
        if not site_plan_path.exists():
            raise SystemExit(f"Site plan PDF not found: {site_plan_path}")
        api_key_env = cfg.get("agent", {}).get("api_key_env", "ANTHROPIC_API_KEY")
        api_key = os.environ.get(api_key_env)
        if not api_key:
            compliance_unavailable_reason = (
                f"site plan provided but {api_key_env} env var is not set"
            )
        else:
            model = cfg.get("agent", {}).get("model", "claude-opus-4-7")
            pdf_bytes = site_plan_path.read_bytes()
            try:
                site_plan_data = await extract_site_plan_data(pdf_bytes, api_key, model)
            except Exception as e:
                site_plan_data = {"status": "error", "error": f"{type(e).__name__}: {e}"}
            if site_plan_data.get("status") != "ok":
                compliance_unavailable_reason = (
                    site_plan_data.get("reason")
                    or site_plan_data.get("error")
                    or "site plan unreadable"
                )
    elif args.compliance:
        compliance_unavailable_reason = (
            "site plan missing — pass --site-plan <pdf> to enable compliance check"
        )

    try:
        dwg_path, tmp_dir = normalize_to_dwg(
            input_path,
            converter_cmd=dwf_cfg.get("command", "dwgConvert"),
            converter_args=dwf_cfg.get("args", []),
            timeout_seconds=int(dwf_cfg.get("timeout_seconds", 120)),
        )
    except DWFConversionError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    source_format = input_path.suffix.lower().lstrip(".")

    try:
        async with connect_autocad_mcp(
            repo_dir=mcp_cfg.get("repo_dir", "autocad-mcp"),
            python_exe=mcp_cfg.get("python_exe", "autocad-mcp/.venv/Scripts/python.exe"),
            backend=mcp_cfg.get("backend", "file_ipc"),
            ipc_timeout=str(mcp_cfg.get("ipc_timeout", "60")),
        ) as mcp:
            status = await mcp.status()
            print(f"autocad-mcp backend: {status}", file=sys.stderr)

            await mcp.open_drawing(dwg_path)
            layers = await mcp.list_layers() or []
            case_insensitive = bool(layer_cfg.get("case_insensitive", True))

            building_layer = resolve_layer_name(
                layers, layer_cfg.get("building", "BUILDING"), case_insensitive
            )
            lot_layer = resolve_layer_name(
                layers, layer_cfg.get("lot", "LOT"), case_insensitive
            )

            building_polys: list[Polyline] = await mcp.extract_polylines(building_layer)
            lot_polys: list[Polyline] = await mcp.extract_polylines(lot_layer)

            building = polylines_to_polygon(building_polys, "building")
            lot = polylines_to_polygon(lot_polys, "lot")

            pairs: list[SetbackPair] = compute_setbacks(building, lot)

            # ---- Compliance: classify edges + compute violations ----
            compliance: ComplianceResult | None = None
            if site_plan_data and site_plan_data.get("status") == "ok":
                street_layer_name = layer_cfg.get("street", "STREET")
                street_layer = find_layer_name(layers, street_layer_name, case_insensitive)
                street_polys: list[Polyline] = []
                if street_layer:
                    street_polys = await mcp.extract_polylines(street_layer)
                tolerance = float(compliance_cfg.get("street_edge_tolerance_m", 10.0))
                fine_rate = float(compliance_cfg.get("fine_per_sqm_jd", 200.0))

                cls_report = classify_edges(
                    lot=lot,
                    street_polylines=street_polys,
                    front_setback_m=site_plan_data["front_setback_m"],
                    side_setback_m=site_plan_data["side_setback_m"],
                    rear_setback_m=site_plan_data["rear_setback_m"],
                    pdf_is_corner_lot=bool(site_plan_data.get("is_corner_lot")),
                    street_edge_tolerance_m=tolerance,
                )

                # ---- Special provisions (الاحكام الخاصة) — overrides on top
                # of the default classification. Skipped silently if the PDF
                # didn't carry any rules; ambiguous rules become reviewer
                # notes rather than auto-applied guesses (option 1).
                side_to_required = {
                    "front": float(site_plan_data["front_setback_m"]),
                    "side": float(site_plan_data["side_setback_m"]),
                }
                if site_plan_data.get("rear_setback_m") is not None:
                    side_to_required["rear"] = float(site_plan_data["rear_setback_m"])
                sp_result = apply_special_provisions(
                    classifications=cls_report.classifications,
                    rules=site_plan_data.get("special_provisions") or [],
                    pdf_streets=site_plan_data.get("streets") or [],
                    lot=lot,
                    side_to_required=side_to_required,
                )

                compliance = compute_violations(
                    building=building,
                    lot=lot,
                    edge_classifications=sp_result.classifications,
                    fine_per_sqm_jd=fine_rate,
                    is_corner_lot=bool(site_plan_data.get("is_corner_lot")),
                )
                # Hoist classifier + special-provisions notes into the
                # compliance result so the markdown/JSON report shows them
                # all in one place.
                compliance.notes = (
                    list(cls_report.notes)
                    + list(sp_result.notes)
                    + list(compliance.notes)
                )
                compliance.applied_special_provisions = [
                    r.to_dict() for r in sp_result.applied_rules
                ]

            json_text = render_json(
                input_path, source_format, pairs,
                compliance=compliance,
                compliance_unavailable=compliance_unavailable_reason if compliance is None else None,
            )
            md_text = render_markdown(
                input_path, source_format, pairs,
                compliance=compliance,
                compliance_unavailable=compliance_unavailable_reason if compliance is None else None,
                site_plan=site_plan_data if (site_plan_data and site_plan_data.get("status") == "ok") else None,
            )

            json_out = Path(args.output_dir) / f"{input_path.stem}_setbacks.json"
            md_out = Path(args.output_dir) / f"{input_path.stem}_setbacks.md"
            json_out.parent.mkdir(parents=True, exist_ok=True)
            json_out.write_text(json_text, encoding="utf-8")
            md_out.write_text(md_text, encoding="utf-8")
            print(md_text)

            if args.annotate:
                dim_layer = layer_cfg.get("setback_dims", "SETBACK_DIMS")
                dim_color = out_cfg.get("dim_color", "yellow")
                dim_offset = float(out_cfg.get("dim_offset", 1.0))

                await mcp.ensure_layer(dim_layer, color=dim_color)
                await mcp.set_current_layer(dim_layer)
                for p in pairs:
                    bx, by = p.building_anchor
                    lx, ly = p.lot_anchor
                    await mcp.draw_aligned_dimension(bx, by, lx, ly, dim_offset)

                # Compliance overlay: dashed envelope + hatched violations on
                # SETBACK_VIOLATION layer.
                if compliance is not None:
                    violation_layer = layer_cfg.get("setback_violation", "SETBACK_VIOLATION")
                    await _annotate_compliance(
                        mcp=mcp,
                        compliance=compliance,
                        layer_name=violation_layer,
                        envelope_color=out_cfg.get("envelope_color", "white"),
                        violation_color=out_cfg.get("violation_color", "red"),
                        hatch_pattern=out_cfg.get("violation_hatch_pattern", "ANSI31"),
                        hatch_scale=float(out_cfg.get("violation_hatch_scale", 1.0)),
                        envelope_linetype=out_cfg.get("envelope_linetype", "DASHED"),
                    )

                await mcp.zoom_extents()
                annotated_suffix = out_cfg.get("annotated_suffix", "_annotated")
                annotated_path = (
                    Path(args.output_dir) / f"{input_path.stem}{annotated_suffix}.dwg"
                ).resolve()
                await mcp.save_drawing(str(annotated_path).replace("\\", "/"))

                if out_cfg.get("pdf", False):
                    pdf_path = annotated_path.with_suffix(".pdf")
                    await mcp.plot_pdf(str(pdf_path).replace("\\", "/"))

        return 0
    finally:
        if tmp_dir is not None:
            shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute per-edge setbacks from a building drawing to its lot boundary."
    )
    parser.add_argument("input", help="Path to a .dwg, .dxf, or .dwf file")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    parser.add_argument("--output-dir", default=".", help="Directory for report outputs")
    parser.add_argument(
        "--annotate",
        action="store_true",
        help="Also produce an annotated DWG with dimension lines",
    )
    parser.add_argument(
        "--site-plan",
        default=None,
        help=(
            "Path to a 'مخطط موقع تنظيمي' PDF carrying the required setbacks. "
            "Enables the Compliance section in the report and the SETBACK_VIOLATION "
            "overlay in the annotated DWG."
        ),
    )
    parser.add_argument(
        "--compliance",
        action="store_true",
        help=(
            "Force the Compliance section even when --site-plan is missing — the "
            "section will read 'cannot evaluate — site plan missing'. Useful for "
            "consistent report shape across runs."
        ),
    )
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
