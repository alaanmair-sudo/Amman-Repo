"""Setback math: build shapely geometry from polylines, compute per-edge distances.

Extended for compliance analysis (see ComplianceResult and friends):
  - per-edge classification by side (front / side / rear) driven by the STREET
    layer in street_classifier.py
  - inward buildable envelope from per-edge required setbacks
  - violation polygon (building ∩ forbidden zones) and per-side breakdown
  - lot-line crossing detection (building − lot)
  - fine = violation_area_m2 × fine_per_sqm_jd
"""

from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Sequence

from shapely.geometry import LineString, Polygon, Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points, polygonize, unary_union

from mcp_client import Polyline


@dataclass
class SetbackPair:
    building_edge_idx: int
    building_edge_start: tuple[float, float]
    building_edge_end: tuple[float, float]
    building_anchor: tuple[float, float]
    lot_anchor: tuple[float, float]
    distance: float

    def to_dict(self) -> dict:
        return asdict(self)


def polylines_to_polygon(polylines: Sequence[Polyline], label: str) -> Polygon:
    """Fold a list of polylines on one layer into a single shapely Polygon.

    Strategy:
      1. If any polyline is already closed, return the largest.
      2. Otherwise, stitch all LINE/polyline segments into a single network via
         `unary_union` + `polygonize` — this handles the common case where a
         boundary is drawn as several discrete LINE entities that meet at
         shared endpoints.
    """
    if not polylines:
        raise ValueError(f"No polylines found on {label} layer")

    closed: list[Polygon] = []
    for p in polylines:
        verts = p.vertices
        if len(verts) < 3:
            continue
        if p.closed or verts[0] == verts[-1]:
            ring = verts if verts[0] == verts[-1] else verts + [verts[0]]
            poly = Polygon(ring)
            if poly.is_valid and poly.area > 0:
                closed.append(poly)

    if closed:
        closed.sort(key=lambda pp: pp.area, reverse=True)
        return closed[0]

    lines: list[LineString] = []
    for p in polylines:
        if len(p.vertices) >= 2:
            lines.append(LineString(p.vertices))

    if lines:
        snap_tol = _infer_snap_tolerance(lines)
        snapped = _snap_endpoints(lines, snap_tol)
        merged = unary_union(snapped)
        rings = list(polygonize(merged))
        if rings:
            rings.sort(key=lambda pp: pp.area, reverse=True)
            return rings[0]

    raise ValueError(
        f"{label} layer has {len(polylines)} entities but they do not form a "
        "closed boundary even after endpoint snapping. Check the drawing."
    )


def _infer_snap_tolerance(lines: list[LineString]) -> float:
    """Tolerance = 0.01% of the overall bounding-box diagonal, clamped to sane range."""
    xs: list[float] = []
    ys: list[float] = []
    for ls in lines:
        for x, y in ls.coords:
            xs.append(x)
            ys.append(y)
    if not xs:
        return 1e-3
    diag = ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2) ** 0.5
    return max(1e-6, min(diag * 1e-4, 0.01))


def _snap_endpoints(lines: list[LineString], tolerance: float) -> list[LineString]:
    """Snap all line endpoints to canonical cluster centroids within `tolerance`."""
    canonical: list[tuple[float, float]] = []

    def canon(pt: tuple[float, float]) -> tuple[float, float]:
        for c in canonical:
            if abs(c[0] - pt[0]) <= tolerance and abs(c[1] - pt[1]) <= tolerance:
                return c
        canonical.append(pt)
        return pt

    out: list[LineString] = []
    for ls in lines:
        coords = list(ls.coords)
        new_coords = [canon((c[0], c[1])) for c in coords]
        if len(new_coords) >= 2:
            out.append(LineString(new_coords))
    return out


def polygon_edges(poly: Polygon) -> list[LineString]:
    coords = list(poly.exterior.coords)
    return [LineString([coords[i], coords[i + 1]]) for i in range(len(coords) - 1)]


def compute_setbacks(building: Polygon, lot: Polygon) -> list[SetbackPair]:
    """For each building edge, find the nearest point on the lot boundary.

    The building anchor is the midpoint of the building edge; the lot anchor is
    the nearest point on the lot's boundary from that midpoint. Distance is
    the Euclidean distance between the two anchors.
    """
    if not building.within(lot) and not building.touches(lot):
        if not lot.contains(building):
            raise ValueError(
                "Building polygon is not fully within the lot polygon. "
                "Check layer assignments and drawing correctness."
            )

    lot_boundary = lot.exterior
    pairs: list[SetbackPair] = []
    for i, edge in enumerate(polygon_edges(building)):
        mid = edge.interpolate(0.5, normalized=True)
        b_pt, l_pt = nearest_points(Point(mid), lot_boundary)
        pairs.append(
            SetbackPair(
                building_edge_idx=i,
                building_edge_start=edge.coords[0][:2],
                building_edge_end=edge.coords[1][:2],
                building_anchor=(b_pt.x, b_pt.y),
                lot_anchor=(l_pt.x, l_pt.y),
                distance=float(b_pt.distance(l_pt)),
            )
        )
    return pairs


# ---------------------------------------------------------------------------
# Compliance: required setbacks → buildable envelope → violation geometry
# ---------------------------------------------------------------------------

# Sides exposed to the user. Two-street corner lots have no "rear".
SIDE_FRONT = "front"
SIDE_SIDE = "side"
SIDE_REAR = "rear"
ALL_SIDES = (SIDE_FRONT, SIDE_SIDE, SIDE_REAR)


@dataclass
class EdgeClassification:
    """One lot edge labelled with its side and the required setback in metres."""
    edge_idx: int
    edge_start: tuple[float, float]
    edge_end: tuple[float, float]
    side: str  # SIDE_FRONT | SIDE_SIDE | SIDE_REAR
    required_setback_m: float
    # Distance from this edge to the nearest STREET polyline segment, in metres.
    # Useful for debugging the street classifier; null if no STREET layer.
    distance_to_street_m: float | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SideViolationSummary:
    """One side's worst-case actual setback + its share of the violation area.

    Per-side areas are NOT mutually exclusive at corners — a building intrusion
    in a corner counts in both adjacent sides' strips. The fine uses the union
    (`ComplianceResult.total_violation_area_m2`); per-side numbers here are for
    the breakdown table only.
    """
    side: str
    required_m: float
    actual_min_m: float | None  # min perpendicular distance from any building corner to a lot edge of this side
    violation_area_m2: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ComplianceResult:
    """End-to-end compliance state for one job, ready to render and to charge."""
    edge_classifications: list[EdgeClassification]
    is_corner_lot: bool

    # Inward-offset buildable envelope. May be empty if the lot geometry
    # cannot accommodate the required setbacks (concave / narrow lots).
    envelope: BaseGeometry  # Polygon | MultiPolygon | empty
    envelope_infeasible: bool

    # Total violation = building ∩ (lot − envelope). Single geometry, no
    # double-counting — drives the fine.
    total_violation: BaseGeometry  # Polygon | MultiPolygon | empty
    total_violation_area_m2: float

    # Per-side breakdown — display only, may double-count corners.
    per_side: dict[str, SideViolationSummary] = field(default_factory=dict)

    # Per-side strips, kept separately so the visualizer can hatch them.
    per_side_strips: dict[str, BaseGeometry] = field(default_factory=dict)

    # Lot-line crossing — building extends OUTSIDE the lot itself. Treated as
    # SERIOUS (more than just a setback violation).
    lot_crossing: BaseGeometry | None = None
    lot_crossing_area_m2: float = 0.0
    is_serious: bool = False

    # Fine in JD = total_violation_area_m2 × fine_per_sqm_jd. Default
    # mirrors config.yaml(.example); only used as a fallback when no
    # rate is passed (config-less callers / debug paths).
    fine_per_sqm_jd: float = 200.0
    fine_jd: float = 0.0

    # Per-zoning-category fine rates (JOD/m²) resolved at compute time
    # from config.yaml's `fines_by_category` table, keyed by the deed's
    # `zoning_region` (or site-plan's `use_type`). Drives the per-fine
    # display on the frontend (setback / building / floor coverage).
    # `fine_rates` is None when zoning couldn't be resolved — submission
    # is then blocked via a missing_data row.
    fine_rates: dict | None = None
    zoning_category_used: str | None = None
    zoning_unresolved: bool = False

    # Optional human-readable warning when envelope is empty / clipped.
    notes: list[str] = field(default_factory=list)

    # Audit log of الاحكام الخاصة rules that were considered for this run.
    # One entry per input rule, in input order. Each entry is a plain dict
    # (shape: AppliedRule.to_dict() in app.special_provisions) so this module
    # stays free of any app-layer dependency. Empty when no rules were
    # supplied or when the site plan didn't carry an الاحكام الخاصة block.
    applied_special_provisions: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "edge_classifications": [c.to_dict() for c in self.edge_classifications],
            "is_corner_lot": self.is_corner_lot,
            "envelope_infeasible": self.envelope_infeasible,
            "envelope_wkt": self.envelope.wkt if not self.envelope.is_empty else None,
            "total_violation_area_m2": self.total_violation_area_m2,
            "total_violation_wkt": (
                self.total_violation.wkt if not self.total_violation.is_empty else None
            ),
            "per_side": {k: v.to_dict() for k, v in self.per_side.items()},
            "lot_crossing_area_m2": self.lot_crossing_area_m2,
            "lot_crossing_wkt": (
                self.lot_crossing.wkt
                if (self.lot_crossing is not None and not self.lot_crossing.is_empty)
                else None
            ),
            "is_serious": self.is_serious,
            "fine_per_sqm_jd": self.fine_per_sqm_jd,
            "fine_jd": self.fine_jd,
            "fine_rates": self.fine_rates,
            "zoning_category_used": self.zoning_category_used,
            "zoning_unresolved": self.zoning_unresolved,
            "notes": list(self.notes),
            "applied_special_provisions": list(self.applied_special_provisions),
        }


def lot_edges(lot: Polygon) -> list[LineString]:
    """Edges of the lot exterior, indexed left-to-right by the polygon's
    coordinate order. Holes are ignored — required setbacks apply to the
    outer boundary only."""
    return polygon_edges(lot)


def _inward_unit_normal(edge: LineString, lot: Polygon) -> tuple[float, float] | None:
    """Unit normal vector pointing FROM the edge INTO the lot interior.

    Tested by sampling a tiny step in each candidate direction from the edge
    midpoint and asking shapely which one lands inside the lot. If neither
    works (degenerate edge), returns None.
    """
    (x1, y1), (x2, y2) = edge.coords[0], edge.coords[1]
    dx, dy = x2 - x1, y2 - y1
    mag = (dx * dx + dy * dy) ** 0.5
    if mag <= 0:
        return None
    # Two perpendicular candidates.
    n1 = (-dy / mag, dx / mag)   # left of edge direction
    n2 = (dy / mag, -dx / mag)   # right of edge direction
    midx, midy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    eps = max(mag, 1.0) * 1e-3
    if lot.contains(Point(midx + n1[0] * eps, midy + n1[1] * eps)):
        return n1
    if lot.contains(Point(midx + n2[0] * eps, midy + n2[1] * eps)):
        return n2
    return None


def _edge_strip(
    edge: LineString,
    inward_normal: tuple[float, float],
    distance: float,
    lot: Polygon,
) -> BaseGeometry:
    """Forbidden zone for one lot edge — every point in the lot within
    `distance` perpendicular distance of the *infinite* line through this
    edge, on the lot's interior side. Implemented as a half-plane (a very
    large quadrilateral) clipped to the lot.

    Why a half-plane and not a flat-cap quadrilateral hugging just the edge
    segment: at acute corners (interior angle < 90°), two adjacent flat-cap
    strips leave a small uncovered wedge near the shared vertex — every point
    in that wedge is within `d` of *both* edge lines, but outside both flat-
    capped quadrilaterals. That wedge survives `lot - union(strips)` and
    visibly protrudes as a sliver in the rendered envelope. The half-plane
    approach makes adjacent forbidden zones overlap by construction, so the
    envelope's corner is the proper geometric inset with no artifacts.
    """
    if distance <= 0:
        return Polygon()
    (x1, y1), (x2, y2) = edge.coords[0], edge.coords[1]
    dx, dy = x2 - x1, y2 - y1
    mag = (dx * dx + dy * dy) ** 0.5
    if mag == 0:
        return Polygon()
    # Unit vectors: along the edge, and perpendicular into the lot.
    ux, uy = dx / mag, dy / mag
    nx, ny = inward_normal

    # Build a quadrilateral large enough to behave as a half-plane when clipped
    # to the lot:
    #   - one side along the OFFSET line (parallel to edge, `distance` inward),
    #     extended far past both ends of the edge along the edge direction
    #   - the opposite side pulled back outward (in -inward direction) past
    #     the original edge by the same far extent, so the half-plane covers
    #     the entire band between the original edge line and the offset line
    minx, miny, maxx, maxy = lot.bounds
    far = ((maxx - minx) ** 2 + (maxy - miny) ** 2) ** 0.5 * 2 + distance + 10
    midx, midy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    # Two points along the offset line, far apart in the edge direction.
    cx = midx + nx * distance
    cy = midy + ny * distance
    a = (cx - ux * far, cy - uy * far)
    b = (cx + ux * far, cy + uy * far)
    # Two more points pushed far outward (away from the lot interior) so the
    # quadrilateral safely covers everything from the offset line back past
    # the original edge.
    c = (b[0] - nx * far, b[1] - ny * far)
    d = (a[0] - nx * far, a[1] - ny * far)
    try:
        half_plane = Polygon([a, b, c, d])
        if not half_plane.is_valid:
            half_plane = half_plane.buffer(0)
        return half_plane.intersection(lot)
    except Exception:
        return Polygon()


def buildable_envelope(
    lot: Polygon, edge_classifications: Sequence[EdgeClassification]
) -> tuple[BaseGeometry, dict[str, BaseGeometry], list[str]]:
    """Compute (envelope, per_side_strips_union, notes).

    envelope = lot − union(all per-edge inward strips).
    per_side_strips_union = {side: union of strips of edges classified as that side}.
    notes = human-readable warnings (e.g. "envelope is empty", "edge has no
    inward direction"); empty if everything succeeded cleanly.
    """
    notes: list[str] = []
    edges = lot_edges(lot)
    per_side_strip_polys: dict[str, list[BaseGeometry]] = {s: [] for s in ALL_SIDES}
    all_strips: list[BaseGeometry] = []

    for cls in edge_classifications:
        if cls.edge_idx < 0 or cls.edge_idx >= len(edges):
            notes.append(f"edge_idx {cls.edge_idx} is out of range; skipped")
            continue
        edge = edges[cls.edge_idx]
        normal = _inward_unit_normal(edge, lot)
        if normal is None:
            notes.append(f"edge {cls.edge_idx} ({cls.side}) has no inward direction; skipped")
            continue
        strip = _edge_strip(edge, normal, cls.required_setback_m, lot)
        if strip.is_empty:
            continue
        all_strips.append(strip)
        per_side_strip_polys.setdefault(cls.side, []).append(strip)

    forbidden_zone = unary_union(all_strips) if all_strips else Polygon()
    try:
        envelope = lot.difference(forbidden_zone)
    except Exception:
        envelope = Polygon()
        notes.append("envelope difference operation failed; treating as infeasible")

    if envelope.is_empty or (hasattr(envelope, "area") and envelope.area <= 0):
        notes.append(
            "envelope infeasible: lot geometry cannot accommodate the required "
            "setbacks; manual review required"
        )

    per_side_union: dict[str, BaseGeometry] = {}
    for side, polys in per_side_strip_polys.items():
        per_side_union[side] = unary_union(polys) if polys else Polygon()

    return envelope, per_side_union, notes


def _min_distance_corner_to_edges(
    building: Polygon, edge_indices: Sequence[int], all_lot_edges: Sequence[LineString]
) -> float | None:
    """For each building corner, take the minimum perpendicular distance to any
    of the given lot edges; return the global minimum across corners.
    Returns None if no edges given.
    """
    if not edge_indices:
        return None
    coords = list(building.exterior.coords)
    if coords and coords[0] == coords[-1]:
        coords = coords[:-1]
    best: float | None = None
    for v in coords:
        pt = Point(v)
        for idx in edge_indices:
            if idx < 0 or idx >= len(all_lot_edges):
                continue
            d = float(pt.distance(all_lot_edges[idx]))
            if best is None or d < best:
                best = d
    return best


def compute_violations(
    building: Polygon,
    lot: Polygon,
    edge_classifications: Sequence[EdgeClassification],
    fine_per_sqm_jd: float = 200.0,
    is_corner_lot: bool = False,
) -> ComplianceResult:
    """End-to-end compliance evaluation. Always returns a ComplianceResult —
    even when the envelope is infeasible or the building exits the lot. The
    caller decides how to render warnings.
    """
    notes: list[str] = []
    envelope, per_side_strips, env_notes = buildable_envelope(lot, edge_classifications)
    notes.extend(env_notes)
    envelope_infeasible = envelope.is_empty or (
        hasattr(envelope, "area") and envelope.area <= 0
    )

    # Total violation = building ∩ (lot − envelope). Use the lot itself when
    # envelope is empty, so a building inside an infeasible lot still has its
    # full footprint counted as the violation area (matches the user's "fine
    # the geometric union" rule + flag for manual review).
    if envelope_infeasible:
        forbidden = lot
    else:
        try:
            forbidden = lot.difference(envelope)
        except Exception:
            forbidden = lot
            notes.append("forbidden-zone computation failed; using full lot")

    try:
        total_violation = building.intersection(forbidden)
    except Exception:
        total_violation = Polygon()
        notes.append("violation intersection failed; reporting zero area")

    total_area = float(getattr(total_violation, "area", 0.0) or 0.0)

    # Per-side breakdown — area attributed by which strip the intrusion sits in.
    edges = lot_edges(lot)
    per_side: dict[str, SideViolationSummary] = {}
    for side in ALL_SIDES:
        # Skip rear for corner lots — there is no rear edge.
        if is_corner_lot and side == SIDE_REAR:
            continue
        idxs = [c.edge_idx for c in edge_classifications if c.side == side]
        if not idxs:
            continue
        required = next(c.required_setback_m for c in edge_classifications if c.side == side)
        strip = per_side_strips.get(side, Polygon())
        try:
            side_violation = building.intersection(strip)
            side_area = float(getattr(side_violation, "area", 0.0) or 0.0)
        except Exception:
            side_area = 0.0
            notes.append(f"per-side intersection failed for {side}; reporting zero area")
        actual_min = _min_distance_corner_to_edges(building, idxs, edges)
        per_side[side] = SideViolationSummary(
            side=side,
            required_m=required,
            actual_min_m=actual_min,
            violation_area_m2=side_area,
        )

    # Lot-line crossing — building portion that exits the lot entirely.
    try:
        lot_crossing = building.difference(lot)
    except Exception:
        lot_crossing = Polygon()
    crossing_area = float(getattr(lot_crossing, "area", 0.0) or 0.0)
    # Use a tiny floating-point threshold so numerical noise on a coincident
    # boundary doesn't trigger the SERIOUS flag.
    is_serious = crossing_area > 1e-6
    if is_serious:
        notes.append(
            f"SERIOUS: building crosses lot boundary by {crossing_area:.3f} m² — "
            "this is more than a setback violation"
        )

    fine = total_area * float(fine_per_sqm_jd)

    return ComplianceResult(
        edge_classifications=list(edge_classifications),
        is_corner_lot=is_corner_lot,
        envelope=envelope,
        envelope_infeasible=envelope_infeasible,
        total_violation=total_violation,
        total_violation_area_m2=total_area,
        per_side=per_side,
        per_side_strips=per_side_strips,
        lot_crossing=lot_crossing if is_serious else None,
        lot_crossing_area_m2=crossing_area if is_serious else 0.0,
        is_serious=is_serious,
        fine_per_sqm_jd=float(fine_per_sqm_jd),
        fine_jd=fine,
        notes=notes,
    )
