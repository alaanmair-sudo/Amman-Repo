"""Render setback + compliance results as JSON and a human-readable markdown
summary.

The Compliance section is appended when:
  - a ComplianceResult is supplied (geometry analysis succeeded), OR
  - a `compliance_unavailable` reason is supplied (PDF missing or unreadable).
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Sequence

from geometry import (
    ALL_SIDES,
    ComplianceResult,
    SetbackPair,
    SIDE_FRONT,
    SIDE_REAR,
    SIDE_SIDE,
)


# Arabic side labels for the report (read by reviewers comfortable in either).
_SIDE_AR = {
    SIDE_FRONT: "Front (امامي)",
    SIDE_SIDE: "Side (جانبي)",
    SIDE_REAR: "Rear (خلفي)",
}


def _cardinal(building_anchor: tuple[float, float], lot_anchor: tuple[float, float]) -> str:
    """Classify the direction from the building edge toward its nearest lot edge."""
    dx = lot_anchor[0] - building_anchor[0]
    dy = lot_anchor[1] - building_anchor[1]
    if abs(dx) > abs(dy):
        return "east" if dx > 0 else "west"
    return "north" if dy > 0 else "south"


def _compliance_to_json_dict(compliance: ComplianceResult | None) -> dict | None:
    """JSON-friendly view of a ComplianceResult — drops shapely WKT for
    brevity (the WKT is in compliance.to_dict() if a consumer wants it)."""
    if compliance is None:
        return None
    return {
        "is_corner_lot": compliance.is_corner_lot,
        "envelope_infeasible": compliance.envelope_infeasible,
        "total_violation_area_m2": compliance.total_violation_area_m2,
        "fine_per_sqm_jd": compliance.fine_per_sqm_jd,
        "fine_jd": compliance.fine_jd,
        "is_serious": compliance.is_serious,
        "lot_crossing_area_m2": compliance.lot_crossing_area_m2,
        "per_side": {k: v.to_dict() for k, v in compliance.per_side.items()},
        "edge_classifications": [c.to_dict() for c in compliance.edge_classifications],
        "notes": list(compliance.notes),
    }


def render_json(
    input_path: Path,
    source_format: str,
    pairs: Sequence[SetbackPair],
    compliance: ComplianceResult | None = None,
    compliance_unavailable: str | None = None,
) -> str:
    payload: dict = {
        "input": str(input_path),
        "source_format": source_format,
        "edge_count": len(pairs),
        "min_setback": min((p.distance for p in pairs), default=None),
        "max_setback": max((p.distance for p in pairs), default=None),
        "edges": [p.to_dict() for p in pairs],
    }
    if compliance is not None:
        payload["compliance"] = _compliance_to_json_dict(compliance)
    elif compliance_unavailable is not None:
        payload["compliance"] = {
            "available": False,
            "reason": compliance_unavailable,
        }
    return json.dumps(payload, indent=2)


def _format_distance(d: float | None) -> str:
    return f"{d:.3f}" if d is not None else "—"


def _render_compliance_section(
    compliance: ComplianceResult | None,
    compliance_unavailable: str | None,
    site_plan: dict | None,
) -> list[str]:
    """Markdown lines for the Compliance section. Returns an empty list when
    neither a ComplianceResult nor an unavailable-reason was supplied (i.e.
    legacy callers that don't know about compliance at all)."""
    if compliance is None and compliance_unavailable is None:
        return []

    lines: list[str] = ["", "## Compliance (مخطط موقع تنظيمي)", ""]

    if compliance is None:
        lines.append(f"**Compliance:** cannot evaluate — {compliance_unavailable}.")
        return lines + [""]

    # Required setbacks block — pulled from the PDF result if provided.
    sp = site_plan or {}
    required_lines: list[str] = []
    for side in ALL_SIDES:
        # Skip rear when the lot is a corner lot.
        if compliance.is_corner_lot and side == SIDE_REAR:
            continue
        sv = compliance.per_side.get(side)
        required = sv.required_m if sv else None
        actual = sv.actual_min_m if sv else None
        violated = sv.violation_area_m2 if sv else 0.0
        marker = ""
        if violated > 0:
            marker = "  ⚠ violated"
        required_lines.append(
            f"- **{_SIDE_AR[side]}** — required {_format_distance(required)} m, "
            f"actual min {_format_distance(actual)} m, "
            f"violation area {violated:.3f} m²{marker}"
        )

    site_id_bits: list[str] = []
    if sp.get("plot_number"): site_id_bits.append(f"plot **{sp['plot_number']}**")
    if sp.get("basin"): site_id_bits.append(f"basin {sp['basin']}")
    if sp.get("village"): site_id_bits.append(f"village {sp['village']}")
    if sp.get("use_type"): site_id_bits.append(f"use: {sp['use_type']}")
    if site_id_bits:
        lines.append("**Site plan:** " + " · ".join(site_id_bits))
        lines.append("")

    corner_str = "yes (2 streets)" if compliance.is_corner_lot else "no"
    lines.append(f"- **Corner lot:** {corner_str}")
    lines.extend(required_lines)
    lines.append("")
    lines.append(
        f"- **Total violation area:** {compliance.total_violation_area_m2:.3f} m² "
        f"_(geometric union — used for the fine, no double-counting at corners)_"
    )
    lines.append(
        f"- **Fine:** **{compliance.fine_jd:,.2f} JD** "
        f"({compliance.fine_per_sqm_jd:.0f} JD per m²)"
    )

    if compliance.envelope_infeasible:
        lines.append(
            "- ⚠ **Envelope infeasible:** the lot geometry cannot accommodate "
            "the required setbacks. Manual review required — the fine above "
            "treats the entire intersected building footprint as a violation."
        )
    if compliance.is_serious:
        lines.append(
            f"- 🚨 **SERIOUS:** the building extends OUTSIDE the lot boundary "
            f"by **{compliance.lot_crossing_area_m2:.3f} m²** — this is more "
            "than a setback violation and should be escalated."
        )
    for note in compliance.notes:
        # Surface only the notes that aren't already captured by the explicit
        # flags above, to avoid duplicate noise.
        if note.startswith("SERIOUS:") or note.startswith("envelope infeasible"):
            continue
        lines.append(f"- _Note:_ {note}")

    # ---- Calculation breakdown — show every step that produced the fine ----
    lines.extend(_render_calculation_breakdown(compliance))

    return lines + [""]


def _render_calculation_breakdown(compliance: ComplianceResult) -> list[str]:
    """Step-by-step math behind `total_violation_area_m2` and `fine_jd`,
    rendered as a markdown subsection inside the Compliance section.

    Layout:
      1. Per-side table — required setback, forbidden-strip area inside the
         lot, and the building's intrusion into that strip
      2. Per-side sum vs. union — explains the corner double-count adjustment
      3. Final fine formula
    """
    sides_present = [s for s in ALL_SIDES if s in compliance.per_side]
    if not sides_present:
        return []

    out: list[str] = ["", "### Calculation breakdown", ""]

    # Step 1 — per-side table.
    out.append("**Step 1 — Per-side strips** (forbidden zones inside the lot, "
               "and the part of the building that intrudes into each):")
    out.append("")
    out.append("| Side | Required setback | Strip area (lot ∩ forbidden zone) | Building intrusion |")
    out.append("|------|-----------------:|----------------------------------:|-------------------:|")
    for side in sides_present:
        sv = compliance.per_side[side]
        strip_geom = compliance.per_side_strips.get(side)
        strip_area = float(getattr(strip_geom, "area", 0.0) or 0.0)
        out.append(
            f"| {_SIDE_AR[side]} "
            f"| {sv.required_m:.3f} m "
            f"| {strip_area:.3f} m² "
            f"| **{sv.violation_area_m2:.3f} m²** |"
        )
    out.append("")

    # Step 2 — per-side sum vs union (this is the corner double-count fix).
    per_side_sum = sum(compliance.per_side[s].violation_area_m2 for s in sides_present)
    union_total = compliance.total_violation_area_m2
    corner_overlap = per_side_sum - union_total
    sum_terms = " + ".join(
        f"{compliance.per_side[s].violation_area_m2:.3f}" for s in sides_present
    )
    out.append(f"**Step 2 — Combine without double-counting corners:**")
    out.append("")
    out.append(f"- Sum of per-side intrusions: {sum_terms} = **{per_side_sum:.3f} m²**")
    if abs(corner_overlap) > 1e-6:
        out.append(
            f"- Subtract corner overlap (where two adjacent strips share area): "
            f"**−{corner_overlap:.3f} m²**"
        )
    else:
        out.append("- Corner overlap: 0.000 m² (no two strips share a building intrusion)")
    out.append(
        f"- **Total violation area (geometric union): {union_total:.3f} m²** "
        "← drives the fine"
    )
    out.append("")

    # Step 3 — fine formula.
    rate = compliance.fine_per_sqm_jd
    fine = compliance.fine_jd
    out.append("**Step 3 — Fine:**")
    out.append("")
    out.append(
        f"- Total violation area × rate = "
        f"{union_total:.3f} m² × {rate:.0f} JD/m² = **{fine:,.2f} JD**"
    )

    # Step 4 — lot-line crossing (only when SERIOUS).
    if compliance.is_serious:
        out.append("")
        out.append("**Step 4 — Lot-line crossing (SERIOUS):**")
        out.append("")
        out.append(
            f"- Building extends outside the lot boundary by "
            f"**{compliance.lot_crossing_area_m2:.3f} m²**. The fine above "
            "includes this area; flag for escalation regardless of fine size."
        )

    return out


def render_markdown(
    input_path: Path,
    source_format: str,
    pairs: Sequence[SetbackPair],
    compliance: ComplianceResult | None = None,
    compliance_unavailable: str | None = None,
    site_plan: dict | None = None,
) -> str:
    if not pairs:
        body = f"# Setback Report\n\nNo building edges found in `{input_path}`.\n"
        compliance_lines = _render_compliance_section(
            compliance, compliance_unavailable, site_plan
        )
        if compliance_lines:
            body += "\n".join(compliance_lines) + "\n"
        return body

    distances = [p.distance for p in pairs]

    lines = [
        "# Setback Report",
        "",
        f"- **Input:** `{input_path}`",
        f"- **Source format:** {source_format}",
        f"- **Building edges:** {len(pairs)}",
        f"- **Overall min:** {min(distances):.3f}",
        f"- **Overall max:** {max(distances):.3f}",
        f"- **Overall mean:** {statistics.mean(distances):.3f}",
        "",
        "| Edge | Faces | Start (x, y) | End (x, y) | Setback | Lot anchor |",
        "|------|-------|--------------|------------|---------|------------|",
    ]
    for p in pairs:
        lines.append(
            f"| {p.building_edge_idx} "
            f"| {_cardinal(p.building_anchor, p.lot_anchor)} "
            f"| ({p.building_edge_start[0]:.2f}, {p.building_edge_start[1]:.2f}) "
            f"| ({p.building_edge_end[0]:.2f}, {p.building_edge_end[1]:.2f}) "
            f"| **{p.distance:.3f}** "
            f"| ({p.lot_anchor[0]:.2f}, {p.lot_anchor[1]:.2f}) |"
        )

    lines.extend(_render_compliance_section(compliance, compliance_unavailable, site_plan))
    return "\n".join(lines) + "\n"
