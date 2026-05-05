"""Tool definitions + Python implementations bridging the AI agent to our existing modules.

Design: tools return small JSON payloads; intermediate Python objects (polylines,
polygons, setback pairs) are stored in the per-job scratchpad and referenced by
opaque string handles. This keeps tool_result payloads cheap and preserves
Python types across tool calls without round-tripping through JSON.

The visualization is rendered client-side from the geometry payload that
`finalize` emits — there is no server-side render step. This saves an entire
agent turn (~3-5 s) per run and removes the matplotlib dependency.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from shapely.geometry import LineString, Point, Polygon

from app.jobs import Job
from app.special_provisions import apply_special_provisions
from dwf_convert import normalize_to_dwg
from geometry import (
    ComplianceResult,
    compute_setbacks,
    compute_violations,
    polylines_to_polygon,
)
from mcp_client import AutoCADMCPClient, Polyline
from report import render_json, render_markdown
from street_classifier import classify_edges


# --- Zoning-category fine-rate lookup ------------------------------------
# The official Amman fines table charges a different JOD/m² rate per
# zoning category × fine type (setback / building / floor coverage).
# Zoning is extracted from the deed PDF (`zoning_region`) or the site
# plan PDF (`use_type`) — both are short Arabic strings. Lookup is
# tolerant: parentheses and the "ال" definite-article prefix are
# stripped, whitespace collapsed, so "سكن (أ)" / "السكن أ" / "سكن أ"
# all resolve to the same row.

def _normalize_zoning(s: str | None) -> str:
    if not s:
        return ""
    s = str(s).strip()
    # Strip ASCII + fullwidth parentheses
    s = re.sub(r"[()（）]", "", s)
    # Strip the leading "ال" definite article on each whitespace-separated word
    s = " ".join(re.sub(r"^ال", "", w) for w in s.split())
    # Collapse internal whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


# Map every alef variant to the canonical "أ" so a deed extracted as
# "سكن ا" (bare alef) still resolves to "سكن أ".
_RESIDENTIAL_LETTERS = {
    "أ": "أ", "إ": "أ", "ا": "أ", "آ": "أ",
    "ب": "ب", "ج": "ج", "د": "د",
}


def _residential_category_from_tokens(tokens: list[str]) -> str | None:
    """If a token list looks like a residential zone with a category
    letter (أ/ب/ج/د) somewhere — even when surrounded by descriptors
    like "اخضر" or "باحكام خاصة" — return the canonical "سكن X" key.
    Returns None when no letter token is present.
    """
    if "سكن" not in tokens:
        return None
    for tok in tokens:
        if tok in _RESIDENTIAL_LETTERS:
            return f"سكن {_RESIDENTIAL_LETTERS[tok]}"
    return None


def resolve_fine_rates(zoning: str | None, fines_table: dict | None) -> dict | None:
    """Return {'setback','building','floor'} JOD/m² rates for the given
    zoning string, or None if unmatched / missing inputs.

    Lookup is two-stage:
      1. Direct normalized match (parens stripped, "ال" stripped, ws collapsed).
      2. Residential letter-priority: when stage 1 misses and the input
         looks like a سكن X with extra descriptors (e.g. "سكن اخضر ب
         باحكام خاصة"), the category letter (أ/ب/ج/د) wins and the input
         is treated as the bare "سكن X" row. Reflects how the Amman zoning
         vocabulary uses "اخضر / باحكام خاصة" as decorations on top of
         the four-letter residential ladder.
    """
    if not fines_table or not zoning:
        return None
    norm_input = _normalize_zoning(zoning)
    if not norm_input:
        return None

    def _row_for(key_form: str) -> dict | None:
        target = _normalize_zoning(key_form)
        for key, rates in fines_table.items():
            if _normalize_zoning(key) == target:
                return {
                    "setback":  float(rates.get("setback",  0)),
                    "building": float(rates.get("building", 0)),
                    "floor":    float(rates.get("floor",    0)),
                }
        return None

    # Stage 1 — direct.
    hit = _row_for(norm_input)
    if hit is not None:
        return hit

    # Stage 2 — residential letter wins over descriptors.
    letter_key = _residential_category_from_tokens(norm_input.split())
    if letter_key:
        hit = _row_for(letter_key)
        if hit is not None:
            return hit
    return None


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "convert_dwf_if_needed",
        "description": (
            "Check the uploaded file. If it is a DWF/DWFx, run the configured commercial "
            "converter to produce a DWG. Returns the DWG path (same as input if already DWG/DXF). "
            "Call this once at the start, before open_drawing."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "open_drawing",
        "description": (
            "Open the (normalized) DWG/DXF file in the running AutoCAD LT session. "
            "Must be called after convert_dwf_if_needed. Returns drawing info."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "list_layers",
        "description": (
            "Return a compact list of layer names present in the currently-open drawing. "
            "Use this to confirm which layers exist before extracting polylines — names may be "
            "misspelled, cased differently, or use synonyms like BLDG/FOOTPRINT/PARCEL/LOT_BOUNDARY."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "extract_polylines",
        "description": (
            "Extract all LWPOLYLINE/POLYLINE/LINE entities on a specific layer. Returns a handle "
            "to the collection plus a summary (count, sample bboxes). Use list_layers first to pick "
            "the actual layer name. The handle is consumed by build_polygon_from_segments."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "layer_name": {"type": "string", "description": "Exact layer name as returned by list_layers."},
                "role": {
                    "type": "string",
                    "enum": ["building", "lot"],
                    "description": "Semantic role of the layer in setback analysis.",
                },
            },
            "required": ["layer_name", "role"],
        },
    },
    {
        "name": "build_polygon_from_segments",
        "description": (
            "Convert a set of polylines/lines into a single closed polygon. Handles both the easy "
            "case (one closed polyline) and the common hard case (separate LINE segments that meet "
            "at endpoints with sub-unit floating-point gaps — they get snapped and stitched)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "polylines_handle": {"type": "string", "description": "Handle returned by extract_polylines."},
                "label": {"type": "string", "enum": ["building", "lot"]},
            },
            "required": ["polylines_handle", "label"],
        },
    },
    {
        "name": "compute_setbacks",
        "description": (
            "Given a building polygon handle and a lot polygon handle, compute the minimum "
            "perpendicular distance from each building edge to the nearest lot edge. Returns a "
            "handle to the pair list plus overall min/max."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "building_handle": {"type": "string"},
                "lot_handle": {"type": "string"},
            },
            "required": ["building_handle", "lot_handle"],
        },
    },
    {
        "name": "extract_street_polylines",
        "description": (
            "Extract polylines from the STREET layer (case-insensitive). Used by "
            "compute_compliance to identify which lot edges face a street, and "
            "therefore which side (front/side/rear) gets which required setback. "
            "Returns a handle plus a count. Call this only when a site plan PDF "
            "is available — otherwise the compliance step is skipped."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "layer_name": {
                    "type": "string",
                    "description": "Exact STREET layer name from list_layers, or 'STREET' as a default.",
                }
            },
            "required": ["layer_name"],
        },
    },
    {
        "name": "compute_compliance",
        "description": (
            "Apply the required setbacks (front/side/rear, in metres) from the "
            "site-plan PDF, classify each lot edge, compute the buildable envelope, "
            "the violation polygon, the per-side breakdown, and the fine. Returns a "
            "handle to the ComplianceResult plus a small summary. Pass street_handle "
            "as null/empty if the STREET layer was not found — every lot edge will "
            "then be treated as a 'side' and a note will say so."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "building_handle": {"type": "string"},
                "lot_handle": {"type": "string"},
                "street_handle": {
                    "type": "string",
                    "description": "Handle from extract_street_polylines; pass empty string if STREET layer is absent.",
                },
                "front_setback_m": {"type": "number"},
                "side_setback_m": {"type": "number"},
                "rear_setback_m": {
                    "type": ["number", "null"],
                    "description": "Required rear setback (metres). null for corner lots (2 streets).",
                },
                "is_corner_lot": {"type": "boolean"},
            },
            "required": [
                "building_handle", "lot_handle",
                "front_setback_m", "side_setback_m", "is_corner_lot",
            ],
        },
    },
    {
        "name": "finalize",
        "description": (
            "Mark the job done with a final summary plus the report (markdown + JSON) and the "
            "geometry payload used by the in-browser interactive renderer. Must be the last tool "
            "call before the agent ends its turn. ALWAYS pass building_handle and lot_handle — "
            "without them the Building area / Lot area / Coverage KPIs in the UI stay blank. Pass "
            "compliance_handle (if compute_compliance was run) or compliance_unavailable (a short "
            "reason string) so the Compliance section is rendered correctly. There is no longer a "
            "separate render step — the visualization is drawn client-side from the geometry."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-paragraph human-readable summary of the analysis."},
                "pairs_handle": {"type": "string"},
                "building_handle": {
                    "type": "string",
                    "description": "Handle from build_polygon_from_segments(label='building'). Required for the Building area + Coverage KPIs.",
                },
                "lot_handle": {
                    "type": "string",
                    "description": "Handle from build_polygon_from_segments(label='lot'). Required for the Lot area + Coverage KPIs.",
                },
                "compliance_handle": {"type": "string"},
                "compliance_unavailable": {
                    "type": "string",
                    "description": "Short reason string when no compliance result is available (e.g. 'site plan missing').",
                },
            },
            "required": ["summary", "pairs_handle", "building_handle", "lot_handle"],
        },
    },
]


class ToolExecutor:
    """Runs tools against the current job + AutoCAD MCP client."""

    def __init__(self, job: Job, mcp: AutoCADMCPClient, cfg: dict):
        self.job = job
        self.mcp = mcp
        self.cfg = cfg

    async def run(self, name: str, args: dict) -> dict:
        handler = getattr(self, f"_{name}", None)
        if handler is None:
            return {"error": f"Unknown tool: {name}"}
        try:
            return await handler(**args)
        except Exception as e:
            return {"error": f"{type(e).__name__}: {e}"}

    async def _convert_dwf_if_needed(self) -> dict:
        input_path = Path(self.job.input_path)
        dwf_cfg = self.cfg.get("dwf_converter", {})
        dwg_path, tmp_dir = normalize_to_dwg(
            input_path,
            converter_cmd=dwf_cfg.get("command", "dwgConvert"),
            converter_args=dwf_cfg.get("args", []),
            timeout_seconds=int(dwf_cfg.get("timeout_seconds", 120)),
        )
        self.job.scratchpad["_dwg_path"] = str(dwg_path)
        self.job.scratchpad["_tmp_dir"] = str(tmp_dir) if tmp_dir else None
        converted = tmp_dir is not None
        return {
            "dwg_path": str(dwg_path),
            "converted": converted,
            "source_format": input_path.suffix.lower().lstrip("."),
        }

    async def _open_drawing(self) -> dict:
        dwg_path = self.job.scratchpad.get("_dwg_path") or self.job.input_path
        await self.mcp.open_drawing(dwg_path)
        return {"opened": dwg_path}

    async def _list_layers(self) -> dict:
        layers = await self.mcp.list_layers() or []
        names = [l.get("name") if isinstance(l, dict) else str(l) for l in layers]
        return {"count": len(names), "layers": names}

    async def _extract_polylines(self, layer_name: str, role: str) -> dict:
        polys: list[Polyline] = await self.mcp.extract_polylines(layer_name)
        handle = self.job.store(f"polylines_{role}", polys)
        sample = []
        for p in polys[:5]:
            xs = [v[0] for v in p.vertices]
            ys = [v[1] for v in p.vertices]
            sample.append(
                {
                    "type": "polyline" if len(p.vertices) > 2 else "line",
                    "vertices": len(p.vertices),
                    "closed": p.closed,
                    "bbox": [min(xs), min(ys), max(xs), max(ys)] if xs else None,
                }
            )
        return {
            "handle": handle,
            "layer": layer_name,
            "role": role,
            "entity_count": len(polys),
            "sample": sample,
        }

    async def _build_polygon_from_segments(self, polylines_handle: str, label: str) -> dict:
        polys: list[Polyline] = self.job.fetch(polylines_handle)
        polygon = polylines_to_polygon(polys, label)
        handle = self.job.store(f"polygon_{label}", polygon)
        return {
            "handle": handle,
            "label": label,
            "area": float(polygon.area),
            "perimeter": float(polygon.length),
            "num_vertices": len(polygon.exterior.coords) - 1,
            "is_valid": bool(polygon.is_valid),
        }

    async def _compute_setbacks(self, building_handle: str, lot_handle: str) -> dict:
        building: Polygon = self.job.fetch(building_handle)
        lot: Polygon = self.job.fetch(lot_handle)
        pairs = compute_setbacks(building, lot)
        handle = self.job.store("pairs", pairs)
        distances = [p.distance for p in pairs]
        return {
            "handle": handle,
            "edge_count": len(pairs),
            "min_setback": min(distances) if distances else None,
            "max_setback": max(distances) if distances else None,
        }

    async def _extract_street_polylines(self, layer_name: str) -> dict:
        """Pull STREET layer polylines using the same LISP path as building/lot."""
        polys: list[Polyline] = await self.mcp.extract_polylines(layer_name)
        handle = self.job.store("polylines_street", polys)
        return {
            "handle": handle,
            "layer": layer_name,
            "entity_count": len(polys),
        }

    async def _compute_compliance(
        self,
        building_handle: str,
        lot_handle: str,
        front_setback_m: float,
        side_setback_m: float,
        is_corner_lot: bool,
        rear_setback_m: float | None = None,
        street_handle: str = "",
    ) -> dict:
        """Classify lot edges via STREET (if available), then compute violations + fine."""
        building: Polygon = self.job.fetch(building_handle)
        lot: Polygon = self.job.fetch(lot_handle)
        street_polys: list[Polyline] = (
            self.job.fetch(street_handle) if street_handle else []
        )
        compliance_cfg = self.cfg.get("compliance", {}) or {}
        tolerance = float(compliance_cfg.get("street_edge_tolerance_m", 10.0))
        fallback_rate = float(compliance_cfg.get("fine_per_sqm_jd", 200.0))

        # ---- Resolve per-category fine rates from the deed/site-plan zoning.
        # Deed PDF's `zoning_region` is the canonical short form (e.g. "سكن أ");
        # fall back to the site-plan's `use_type` if the deed didn't extract.
        # If neither resolves to a row in `fines_by_category`, leave rates as
        # None so downstream validation flags the application as un-fineable
        # (blocks submission per business rule).
        deed_zoning = (self.job.pdf_result or {}).get("zoning_region") if self.job.pdf_result else None
        sp_zoning   = (self.job.site_plan_result or {}).get("use_type") if self.job.site_plan_result else None
        zoning_input = deed_zoning or sp_zoning
        fines_table = compliance_cfg.get("fines_by_category") or {}
        fine_rates  = resolve_fine_rates(zoning_input, fines_table)
        # Setback fine uses the resolved category's setback rate; if zoning
        # is unresolved, the setback fine falls back to the legacy flat rate
        # so the geometry pipeline still produces a number — the missing
        # category surfaces separately as a missing_data row.
        fine_rate = float(fine_rates["setback"]) if fine_rates else fallback_rate

        cls_report = classify_edges(
            lot=lot,
            street_polylines=street_polys,
            front_setback_m=float(front_setback_m),
            side_setback_m=float(side_setback_m),
            rear_setback_m=(float(rear_setback_m) if rear_setback_m is not None else None),
            pdf_is_corner_lot=bool(is_corner_lot),
            street_edge_tolerance_m=tolerance,
        )

        # ---- Special provisions (الاحكام الخاصة) — applied on top of the
        # default classification using rules + street list captured by the
        # site-plan extractor. Skipped silently if the PDF didn't carry any
        # rules, or if the site-plan pipeline hasn't populated job.site_plan_result
        # yet (it normally has, since the agent waits on it before calling this
        # tool — but the extractor failure paths leave it unset).
        sp_payload: dict = self.job.site_plan_result or {}
        rules = sp_payload.get("special_provisions") or []
        pdf_streets = sp_payload.get("streets") or []
        side_to_required: dict[str, float] = {
            "front": float(front_setback_m),
            "side": float(side_setback_m),
        }
        if rear_setback_m is not None:
            side_to_required["rear"] = float(rear_setback_m)
        sp_result = apply_special_provisions(
            classifications=cls_report.classifications,
            rules=rules,
            pdf_streets=pdf_streets,
            lot=lot,
            side_to_required=side_to_required,
        )

        compliance = compute_violations(
            building=building,
            lot=lot,
            edge_classifications=sp_result.classifications,
            fine_per_sqm_jd=fine_rate,
            is_corner_lot=bool(is_corner_lot),
        )
        # Hoist classifier + special-provisions notes into the compliance
        # result so the consumer only has to look in one place.
        compliance.notes = (
            list(cls_report.notes)
            + list(sp_result.notes)
            + list(compliance.notes)
        )
        compliance.applied_special_provisions = [
            r.to_dict() for r in sp_result.applied_rules
        ]
        compliance.fine_rates = fine_rates
        compliance.zoning_category_used = zoning_input
        compliance.zoning_unresolved = fine_rates is None

        handle = self.job.store("compliance", compliance)
        return {
            "handle": handle,
            "is_corner_lot": compliance.is_corner_lot,
            "front_edge_count": cls_report.front_edge_count,
            "side_edge_count": cls_report.side_edge_count,
            "rear_edge_count": cls_report.rear_edge_count,
            "envelope_infeasible": compliance.envelope_infeasible,
            "total_violation_area_m2": compliance.total_violation_area_m2,
            "fine_jd": compliance.fine_jd,
            "is_serious": compliance.is_serious,
            "lot_crossing_area_m2": compliance.lot_crossing_area_m2,
            "per_side": {
                k: {"required_m": v.required_m,
                    "actual_min_m": v.actual_min_m,
                    "violation_area_m2": v.violation_area_m2}
                for k, v in compliance.per_side.items()
            },
            "pdf_corner_mismatch": cls_report.pdf_corner_mismatch,
            "applied_special_provisions": list(compliance.applied_special_provisions),
            "notes": list(compliance.notes),
            # Per-category fine rates (JOD/m² per fine type) — drives the
            # frontend setback / building / floor-coverage fine displays.
            # `null` rates signal "zoning category required" to validation
            # and the UI; submission is blocked in that case.
            "fine_rates": fine_rates,
            "zoning_category_used": zoning_input,
            "zoning_unresolved": fine_rates is None,
        }

    # NOTE: `_render_visualization` was removed when the in-browser SVG
    # renderer became the only visualization path. The agent no longer has
    # a render tool — it goes straight from compute_compliance to finalize.

    async def _finalize(
        self,
        summary: str,
        pairs_handle: str,
        building_handle: str | None = None,
        lot_handle: str | None = None,
        compliance_handle: str = "",
        compliance_unavailable: str = "",
        # `png_handle` is no longer used — the visualization is drawn
        # client-side from `geometry_json`. Accepted as a no-op kwarg so
        # historical agents (e.g. a paused conversation that thinks the
        # tool still exists) don't fail on unexpected input.
        png_handle: str = "",
    ) -> dict:
        pairs = self.job.fetch(pairs_handle)

        # Defensive fallback — if the agent forgot to pass building_handle or
        # lot_handle, look them up by their well-known scratchpad key prefix
        # ("polygon_building_*" / "polygon_lot_*" set by build_polygon_from_segments).
        # Without this, building_area / lot_area / coverage_pct silently come
        # back as None and the corresponding KPI tiles in the UI stay blank.
        def _scratch_lookup(prefix: str):
            for k, v in self.job.scratchpad.items():
                if k.startswith(prefix):
                    return v
            return None

        building = (
            self.job.fetch(building_handle) if building_handle
            else _scratch_lookup("polygon_building_")
        )
        lot = (
            self.job.fetch(lot_handle) if lot_handle
            else _scratch_lookup("polygon_lot_")
        )
        compliance: ComplianceResult | None = (
            self.job.fetch(compliance_handle) if compliance_handle else None
        )
        input_path = Path(self.job.input_path)
        source_format = input_path.suffix.lower().lstrip(".")
        building_area = float(building.area) if building is not None else None
        lot_area = float(lot.area) if lot is not None else None
        coverage_pct = (
            (building_area / lot_area * 100.0)
            if (building_area is not None and lot_area and lot_area > 0)
            else None
        )
        # Site-plan dict used to render the Compliance section header.
        site_plan_for_report: dict | None = None
        sp = self.job.site_plan_result
        if sp and sp.get("status") == "ok":
            site_plan_for_report = sp

        # Reason fallback when no compliance result was computed but the user
        # didn't supply one — derive from job state to keep the report honest.
        unavailable_reason: str | None = compliance_unavailable.strip() or None
        if compliance is None and unavailable_reason is None:
            if not self.job.site_plan_expected:
                unavailable_reason = "site plan missing"
            elif sp and sp.get("status") != "ok":
                unavailable_reason = sp.get("reason") or sp.get("error") or "site plan unreadable"

        compliance_dict: dict | None = None
        if compliance is not None:
            compliance_dict = {
                "is_corner_lot": compliance.is_corner_lot,
                "envelope_infeasible": compliance.envelope_infeasible,
                "total_violation_area_m2": compliance.total_violation_area_m2,
                "fine_per_sqm_jd": compliance.fine_per_sqm_jd,
                "fine_jd": compliance.fine_jd,
                "is_serious": compliance.is_serious,
                "lot_crossing_area_m2": compliance.lot_crossing_area_m2,
                "per_side": {k: v.to_dict() for k, v in compliance.per_side.items()},
                "edge_classifications": [c.to_dict() for c in compliance.edge_classifications],
                "applied_special_provisions": list(compliance.applied_special_provisions),
                "notes": list(compliance.notes),
                "fine_rates": compliance.fine_rates,
                "zoning_category_used": compliance.zoning_category_used,
                "zoning_unresolved": compliance.zoning_unresolved,
            }

        # ── geometry_json — payload for the interactive in-browser SVG
        # ── renderer (Option C). Carries enough geometry for the frontend
        # ── to draw the lot, building, classified edges, envelope,
        # ── violation polys, street centrelines, and per-edge setback
        # ── leader lines without re-running the agent. Coordinates stay in
        # ── the original CAD system (typically metres) — the SVG renderer
        # ── flips Y for screen coords and computes its own viewBox from
        # ── the full extent. Old archived analyses (saved before this
        # ── field existed) get None on read; the frontend falls back to
        # ── the static PNG in that case.
        def _ring_to_coords(poly):
            if poly is None:
                return None
            try:
                return [[float(x), float(y)] for x, y in poly.exterior.coords]
            except Exception:
                return None

        def _multipoly_rings(geom):
            """Flatten a Polygon/MultiPolygon/GeometryCollection into a list
            of {exterior, interiors} dicts. Empty geom → []."""
            out: list[dict] = []
            if geom is None or getattr(geom, "is_empty", True):
                return out
            geoms = (
                [geom] if hasattr(geom, "exterior")
                else list(getattr(geom, "geoms", []) or [])
            )
            for g in geoms:
                if not hasattr(g, "exterior"):
                    continue
                out.append({
                    "exterior": _ring_to_coords(g),
                    "interiors": [
                        [[float(x), float(y)] for x, y in ring.coords]
                        for ring in (g.interiors or [])
                    ],
                })
            return out

        # Streets aren't passed in directly; pull them from scratchpad if
        # extract_street_polylines ran for this job. Empty list when
        # absent (no STREET layer / compliance skipped).
        # Also synthesize a "band" polygon for each street centerline by
        # buffering it. The DWG STREET layer is just a centerline; the
        # actual road width isn't recorded anywhere in the drawing, so we
        # use a fixed default. The street_edge_tolerance_m config value
        # (default 10 m) is the same threshold the classifier uses to
        # decide whether a lot edge "faces a street" — keeping the band
        # width consistent with that means a lot edge classified as
        # `front` will visually sit beside the band, which is the
        # association we want.
        compliance_cfg = self.cfg.get("compliance", {}) or {}
        street_width_m = float(compliance_cfg.get("street_edge_tolerance_m", 10.0))
        streets_payload: list[dict] = []
        for k, v in self.job.scratchpad.items():
            if k.startswith("polylines_street") and isinstance(v, list):
                for sp in v:
                    try:
                        coords = [[float(x), float(y)] for x, y in sp.vertices]
                        if len(coords) < 2:
                            continue
                        # Buffer the centerline by half the band width on
                        # both sides. Flat caps so the band ends at the
                        # last vertex rather than a half-circle bulge,
                        # which reads as "this is a road segment in the
                        # neighborhood of the lot," not a stretched pill.
                        line = LineString([(c[0], c[1]) for c in coords])
                        band_poly = line.buffer(street_width_m / 2.0,
                                                cap_style=2, join_style=2)
                        band_coords = None
                        if band_poly is not None and not band_poly.is_empty:
                            try:
                                band_coords = [
                                    [float(x), float(y)]
                                    for x, y in band_poly.exterior.coords
                                ]
                            except AttributeError:
                                band_coords = None
                        streets_payload.append({
                            "coords": coords,
                            "closed": bool(sp.closed),
                            "band": band_coords,
                            "width_m": street_width_m,
                        })
                    except Exception:
                        continue
                break

        geometry_json: dict = {
            "lot": {
                "coords": _ring_to_coords(lot),
                "area_m2": lot_area,
            },
            "building": {
                "coords": _ring_to_coords(building),
                "area_m2": building_area,
            },
            "streets": streets_payload,
            "summary": {
                "building_area_m2": building_area,
                "lot_area_m2": lot_area,
                "coverage_pct": coverage_pct,
                "violation_area_m2": (
                    compliance.total_violation_area_m2 if compliance else None
                ),
                "fine_jd": compliance.fine_jd if compliance else None,
                "is_serious": bool(compliance.is_serious) if compliance else False,
                "is_corner_lot": bool(compliance.is_corner_lot) if compliance else False,
                "envelope_infeasible": (
                    bool(compliance.envelope_infeasible) if compliance else False
                ),
            },
        }
        # Per-edge setback pairs: leader lines + distance labels. The
        # building/lot anchors come straight from compute_setbacks; the
        # frontend draws a thin line between them and labels the midpoint.
        # Each pair is augmented with the side classification + required
        # setback of the lot edge it pairs against, and a precomputed
        # `is_violation` flag, so the frontend can render only the
        # violating pairs (compliant edges have nothing actionable to show
        # — the per-side minimums are already on the panel KPIs and the
        # red-hatched violation polygons make the geometry obvious).
        def _nearest_classified_edge(point_xy):
            """Return (side, required_m) for the classified lot edge whose
            segment is closest to the lot anchor point. None,None when no
            classification was run (compliance flow skipped)."""
            if compliance is None or not compliance.edge_classifications:
                return None, None
            p = Point(point_xy)
            best_side: str | None = None
            best_required: float | None = None
            best_d = float("inf")
            for cls in compliance.edge_classifications:
                seg = LineString([cls.edge_start, cls.edge_end])
                d = p.distance(seg)
                if d < best_d:
                    best_d = d
                    best_side = cls.side
                    best_required = float(cls.required_setback_m)
            return best_side, best_required

        if pairs:
            pair_dicts: list[dict] = []
            for p in pairs:
                side, required = _nearest_classified_edge(p.lot_anchor)
                # 1 cm tolerance — a "compliant" edge with distance equal
                # to required (within rounding) shouldn't trip the
                # violation flag.
                is_violation = (
                    side is not None
                    and required is not None
                    and float(p.distance) + 0.01 < required
                )
                pair_dicts.append({
                    "building_anchor": [float(p.building_anchor[0]), float(p.building_anchor[1])],
                    "lot_anchor":      [float(p.lot_anchor[0]),      float(p.lot_anchor[1])],
                    "building_edge_start": [float(p.building_edge_start[0]), float(p.building_edge_start[1])],
                    "building_edge_end":   [float(p.building_edge_end[0]),   float(p.building_edge_end[1])],
                    "distance_m": float(p.distance),
                    "side": side,
                    "required_m": required,
                    "is_violation": bool(is_violation),
                })
            geometry_json["pairs"] = pair_dicts
        # Compliance-only payload: edge classifications (per-side colors +
        # required setbacks), envelope outline, violation polygons, and
        # any "outside lot" SERIOUS regions.
        if compliance is not None:
            geometry_json["edges"] = [
                {
                    "start": [float(c.edge_start[0]), float(c.edge_start[1])],
                    "end":   [float(c.edge_end[0]),   float(c.edge_end[1])],
                    "side": c.side,
                    "required_m": float(c.required_setback_m),
                }
                for c in compliance.edge_classifications
            ]
            geometry_json["envelope"] = _multipoly_rings(compliance.envelope)
            geometry_json["violations"] = _multipoly_rings(compliance.total_violation)
            geometry_json["lot_crossing"] = _multipoly_rings(compliance.lot_crossing)

        self.job.result = {
            "summary": summary,
            "markdown": render_markdown(
                input_path, source_format, pairs,
                compliance=compliance,
                compliance_unavailable=unavailable_reason if compliance is None else None,
                site_plan=site_plan_for_report,
            ),
            "json": render_json(
                input_path, source_format, pairs,
                compliance=compliance,
                compliance_unavailable=unavailable_reason if compliance is None else None,
            ),
            "geometry_json": geometry_json,
            "edge_count": len(pairs),
            "building_area": building_area,
            "lot_area": lot_area,
            "coverage_pct": coverage_pct,
            "compliance": compliance_dict,
            "compliance_unavailable": unavailable_reason if compliance is None else None,
        }
        self.job.status = "done"
        return {"ok": True, "edges": len(pairs), "compliance_evaluated": compliance is not None}
