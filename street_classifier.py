"""Map lot edges to {front, side, rear} using a STREET layer + the per-side
required setbacks from the site-plan PDF.

The municipal site plan gives three setback values:
  - امامي (front)  — applied to every lot edge that fronts a street
  - جانبي (side)  — applied to all non-front, non-rear edges
  - خلفي  (rear)  — applied to the lot edge OPPOSITE the street (single-front
                    lots only; corner lots have no rear)

We identify front edges by checking each lot edge's distance to the STREET
polyline and accepting it as "front" if within `street_edge_tolerance_m`. The
default tolerance is 10 m so a STREET drawn as the road's outer edge or
centerline is still detectable from the lot edge.

Cross-validation: the PDF declares is_corner_lot. The geometry should agree.
We return a `mismatch` flag rather than failing, so a reviewer can resolve
the discrepancy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from shapely.geometry import LineString, Polygon, Point

from geometry import (
    ALL_SIDES,
    SIDE_FRONT,
    SIDE_REAR,
    SIDE_SIDE,
    EdgeClassification,
    lot_edges,
)
from mcp_client import Polyline


@dataclass
class ClassificationReport:
    """Side-classification output plus diagnostics for the report."""
    classifications: list[EdgeClassification]
    is_corner_lot_geometry: bool          # whether the geometry shows ≥2 street-facing edges
    front_edge_count: int
    side_edge_count: int
    rear_edge_count: int
    street_edges_present: bool             # whether any STREET polyline was supplied
    pdf_corner_mismatch: bool              # PDF said one thing, geometry says another
    notes: list[str]


def _street_segments(street_polylines: Sequence[Polyline]) -> list[LineString]:
    """Flatten the STREET polylines into individual line segments — distance
    queries against many tiny segments are cheaper than against a single long
    polyline (and more accurate for non-axis-aligned shapes)."""
    segments: list[LineString] = []
    for p in street_polylines:
        verts = p.vertices
        if len(verts) < 2:
            continue
        for i in range(len(verts) - 1):
            try:
                segments.append(LineString([verts[i], verts[i + 1]]))
            except Exception:
                continue
        # If the source was a closed polyline, also include the closing segment.
        if p.closed and len(verts) >= 3 and verts[0] != verts[-1]:
            try:
                segments.append(LineString([verts[-1], verts[0]]))
            except Exception:
                pass
    return segments


def _edge_distance_to_street(
    edge: LineString, street_segments: Sequence[LineString]
) -> float | None:
    """Min distance from this lot edge to ANY street segment, computed at the
    edge midpoint (cheap and accurate enough for the tolerance test).

    Returns None if no street segments were supplied.
    """
    if not street_segments:
        return None
    mid = edge.interpolate(0.5, normalized=True)
    best = float("inf")
    for s in street_segments:
        d = float(mid.distance(s))
        if d < best:
            best = d
    return best if best != float("inf") else None


def _opposite_edge_idx(lot: Polygon, front_edge_idx: int) -> int | None:
    """Among all non-front lot edges, pick the one whose midpoint is FARTHEST
    from the front edge's midpoint — that's the rear.

    For rectangular lots this is unambiguous. For irregular polygons it's a
    heuristic; the report includes the chosen rear so a reviewer can verify.
    """
    edges = lot_edges(lot)
    if front_edge_idx < 0 or front_edge_idx >= len(edges):
        return None
    front_mid = edges[front_edge_idx].interpolate(0.5, normalized=True)
    best_idx: int | None = None
    best_d = -1.0
    for i, e in enumerate(edges):
        if i == front_edge_idx:
            continue
        d = float(front_mid.distance(e.interpolate(0.5, normalized=True)))
        if d > best_d:
            best_d = d
            best_idx = i
    return best_idx


def classify_edges(
    lot: Polygon,
    street_polylines: Sequence[Polyline],
    front_setback_m: float,
    side_setback_m: float,
    rear_setback_m: float | None,
    pdf_is_corner_lot: bool,
    street_edge_tolerance_m: float = 10.0,
) -> ClassificationReport:
    """Classify every lot edge as front / side / rear and attach the required
    setback. The required setback is taken from the site-plan PDF.

    Algorithm:
      1. Front edges = lot edges within `street_edge_tolerance_m` of any
         STREET polyline segment (measured at the edge midpoint).
      2. Geometry-corner = (front_count ≥ 2). Cross-check against the PDF.
      3. Non-corner: rear = the non-front edge farthest from the front edge.
                     All other non-front edges = sides.
      4. Corner: every non-front edge = side. No rear edge exists (rear value
                 from the PDF must be null in this case).
      5. If no STREET geometry is available, fall back to "every lot edge is a
         side" (uses side_setback_m everywhere) and emit a note. The geometry
         analysis still works; the per-side breakdown will just lump all edges
         under "side".
    """
    notes: list[str] = []
    edges = lot_edges(lot)
    n_edges = len(edges)
    if n_edges == 0:
        return ClassificationReport(
            classifications=[],
            is_corner_lot_geometry=False,
            front_edge_count=0,
            side_edge_count=0,
            rear_edge_count=0,
            street_edges_present=False,
            pdf_corner_mismatch=False,
            notes=["lot polygon has no exterior edges"],
        )

    street_segments = _street_segments(street_polylines)
    street_present = bool(street_segments)

    # Per-edge distance to street (None if no street layer).
    distances: list[float | None] = [
        _edge_distance_to_street(e, street_segments) for e in edges
    ]

    # Identify front edges by tolerance.
    front_indices: list[int] = []
    if street_present:
        for i, d in enumerate(distances):
            if d is not None and d <= street_edge_tolerance_m:
                front_indices.append(i)

    if not street_present:
        notes.append(
            "no STREET layer supplied — front/rear/side classification "
            "unavailable; treating every lot edge as a 'side' for the "
            "compliance calculation"
        )
    elif not front_indices:
        notes.append(
            f"no lot edge is within {street_edge_tolerance_m:.2f} m of the "
            "STREET layer — front edge could not be identified; treating "
            "every lot edge as 'side'"
        )

    # Decide rear edge (single-front lots only).
    rear_idx: int | None = None
    geometry_is_corner = len(front_indices) >= 2
    if len(front_indices) == 1 and not pdf_is_corner_lot:
        rear_idx = _opposite_edge_idx(lot, front_indices[0])
        if rear_idx is None:
            notes.append("could not determine rear edge; treating opposite edge as side")

    # PDF vs geometry cross-check.
    pdf_corner_mismatch = (geometry_is_corner != pdf_is_corner_lot)
    if pdf_corner_mismatch:
        notes.append(
            f"PDF says is_corner_lot={pdf_is_corner_lot} but geometry shows "
            f"{len(front_indices)} street-facing edge(s); using PDF value "
            "for setback assignment but flagging the mismatch"
        )

    # When the PDF says corner, the rear setback must be null. Force rear_idx
    # to None even if the geometry tried to pick one.
    if pdf_is_corner_lot:
        rear_idx = None
        if rear_setback_m is not None:
            notes.append(
                "PDF marks lot as corner but a rear setback value was provided; "
                "ignoring rear value and applying side setback to all non-front edges"
            )
            rear_setback_m = None

    # Build classifications. Default everything to side, then override with
    # front and rear.
    side_to_required: dict[str, float] = {
        SIDE_FRONT: front_setback_m,
        SIDE_SIDE: side_setback_m,
    }
    if rear_setback_m is not None:
        side_to_required[SIDE_REAR] = rear_setback_m

    classifications: list[EdgeClassification] = []
    front_count = side_count = rear_count = 0
    for i, e in enumerate(edges):
        (x1, y1), (x2, y2) = e.coords[0], e.coords[1]
        if i in front_indices:
            side = SIDE_FRONT
            front_count += 1
        elif rear_idx is not None and i == rear_idx:
            side = SIDE_REAR
            rear_count += 1
        else:
            side = SIDE_SIDE
            side_count += 1
        classifications.append(
            EdgeClassification(
                edge_idx=i,
                edge_start=(float(x1), float(y1)),
                edge_end=(float(x2), float(y2)),
                side=side,
                required_setback_m=side_to_required[side],
                distance_to_street_m=distances[i],
            )
        )

    return ClassificationReport(
        classifications=classifications,
        is_corner_lot_geometry=geometry_is_corner,
        front_edge_count=front_count,
        side_edge_count=side_count,
        rear_edge_count=rear_count,
        street_edges_present=street_present,
        pdf_corner_mismatch=pdf_corner_mismatch,
        notes=notes,
    )
