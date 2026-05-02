"""Apply الاحكام الخاصة (special provisions) on top of the default per-edge
classification produced by street_classifier.classify_edges.

Two rule shapes are recognised today:
  - setback_override: change the required_setback_m on the edge facing a
    named street.
  - side_reclassification: change which edges are front/side/rear based on a
    condition like "if the lot fronts 3 streets".

Unrecognised rules are surfaced to the reviewer in the report but never
modify the classification — that's a deliberate "fail safe" choice so a
mis-classified rule cannot silently skew compliance numbers.

Disambiguation policy ("option 1"):
  When a setback_override targets a named street but the geometry has more
  than one street-facing edge, we DO NOT guess which edge it applies to.
  The rule is logged with status="ambiguous_needs_review" and skipped; the
  report shows the rule's raw text and a note that the reviewer must pick
  the matching front edge by hand.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Sequence

from shapely.geometry import LineString, Polygon

from geometry import (
    SIDE_FRONT,
    SIDE_REAR,
    SIDE_SIDE,
    EdgeClassification,
    lot_edges,
)


# Status codes attached to each AppliedRule entry. The report renders these
# verbatim — keep them stable so frontend filters can branch on them.
STATUS_APPLIED = "applied"
STATUS_SKIPPED_CONDITION_FALSE = "skipped_condition_false"
STATUS_AMBIGUOUS_NEEDS_REVIEW = "ambiguous_needs_review"
STATUS_NO_MATCH = "no_match"
STATUS_UNRECOGNIZED = "unrecognized"


@dataclass
class AppliedRule:
    """Audit log entry for one rule's evaluation. Always returned even when
    the rule did not modify anything, so the reviewer sees why."""
    rule_index: int
    rule_type: str
    raw_text: str
    status: str
    detail: str
    affected_edge_indices: list[int] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SpecialProvisionsResult:
    """Output of `apply_special_provisions`.

    `classifications` is a NEW list (input is never mutated). `applied_rules`
    is one entry per input rule, in input order. `notes` are short
    human-readable strings hoisted to the top of the report.
    """
    classifications: list[EdgeClassification]
    applied_rules: list[AppliedRule]
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "classifications": [c.to_dict() for c in self.classifications],
            "applied_rules": [r.to_dict() for r in self.applied_rules],
            "notes": list(self.notes),
        }


def _opposite_edge_idx(lot: Polygon, edge_idx: int) -> int | None:
    """Lot edge whose midpoint is FARTHEST from `edge_idx`'s midpoint.

    Same heuristic as street_classifier._opposite_edge_idx; duplicated here
    rather than imported so this module doesn't depend on a private name
    that could be renamed without notice. For rectangles it's unambiguous;
    for irregular polygons it's a best-effort pick the report surfaces so
    a reviewer can spot it.
    """
    edges = lot_edges(lot)
    if edge_idx < 0 or edge_idx >= len(edges):
        return None
    target_mid = edges[edge_idx].interpolate(0.5, normalized=True)
    best_idx: int | None = None
    best_d = -1.0
    for i, e in enumerate(edges):
        if i == edge_idx:
            continue
        d = float(target_mid.distance(e.interpolate(0.5, normalized=True)))
        if d > best_d:
            best_d = d
            best_idx = i
    return best_idx


def _front_classifications(classifications: Sequence[EdgeClassification]) -> list[EdgeClassification]:
    return [c for c in classifications if c.side == SIDE_FRONT]


def _non_front_classification(
    classifications: Sequence[EdgeClassification],
) -> EdgeClassification | None:
    """The single non-front edge. Returns None when there is zero or more
    than one — the rules using this descriptor only make sense for the
    "exactly one non-front edge" case (typical 3-streets lot)."""
    nf = [c for c in classifications if c.side != SIDE_FRONT]
    return nf[0] if len(nf) == 1 else None


def _evaluate_street_count_condition(
    cond: dict, classifications: Sequence[EdgeClassification]
) -> tuple[bool, str]:
    """Returns (matches, detail). `detail` is shown in the audit log."""
    operator = str(cond.get("operator") or "==")
    target = cond.get("value")
    try:
        target_int = int(target)
    except (TypeError, ValueError):
        return False, f"condition value {target!r} is not an integer"
    actual = sum(1 for c in classifications if c.side == SIDE_FRONT)
    if operator == "==":
        return (actual == target_int), f"actual front count={actual}, rule wants =={target_int}"
    if operator == ">=":
        return (actual >= target_int), f"actual front count={actual}, rule wants >={target_int}"
    if operator == "<=":
        return (actual <= target_int), f"actual front count={actual}, rule wants <={target_int}"
    return False, f"unknown operator {operator!r}"


def _resolve_reclassify_target(
    target: str,
    classifications: Sequence[EdgeClassification],
    lot: Polygon,
) -> list[int]:
    """Map a target descriptor to concrete edge indices."""
    if target == "non_front_edge":
        nf = _non_front_classification(classifications)
        return [nf.edge_idx] if nf else []
    if target == "edge_opposite_to_non_front":
        nf = _non_front_classification(classifications)
        if nf is None:
            return []
        opp = _opposite_edge_idx(lot, nf.edge_idx)
        return [opp] if opp is not None else []
    if target == "all_front_edges":
        return [c.edge_idx for c in classifications if c.side == SIDE_FRONT]
    if target == "all_side_edges":
        return [c.edge_idx for c in classifications if c.side == SIDE_SIDE]
    if target == "all_rear_edges":
        return [c.edge_idx for c in classifications if c.side == SIDE_REAR]
    return []


def _apply_setback_override(
    rule: dict,
    classifications: list[EdgeClassification],
    pdf_streets: Sequence[dict],
    rule_index: int,
) -> AppliedRule:
    """Override the required_setback_m on the front edge facing a named street.

    Disambiguation: if there are >1 front edges and we can't pin the rule to
    a single one, return ambiguous_needs_review (option 1). Single front
    edge → apply unconditionally. Zero front edges → no_match.
    """
    cond = rule.get("condition") or {}
    eff = rule.get("effect") or {}
    raw_text = str(rule.get("raw_text") or "")
    rule_street_name = str(cond.get("street_name") or "").strip()
    target_side = str(eff.get("target_side") or "").lower()
    try:
        value_m = float(eff.get("value_m"))
    except (TypeError, ValueError):
        return AppliedRule(
            rule_index=rule_index,
            rule_type="setback_override",
            raw_text=raw_text,
            status=STATUS_UNRECOGNIZED,
            detail="effect.value_m is missing or not numeric",
        )

    if target_side != SIDE_FRONT:
        return AppliedRule(
            rule_index=rule_index,
            rule_type="setback_override",
            raw_text=raw_text,
            status=STATUS_UNRECOGNIZED,
            detail=(
                f"target_side='{target_side}' not yet supported (only 'front' "
                "overrides on a street-facing edge are wired up today)"
            ),
        )

    # Confirm the PDF actually lists this street name. If not, the rule
    # references something that isn't on this lot — silently skip it.
    if not any(
        (s.get("name") or "").strip() == rule_street_name for s in (pdf_streets or [])
    ):
        return AppliedRule(
            rule_index=rule_index,
            rule_type="setback_override",
            raw_text=raw_text,
            status=STATUS_NO_MATCH,
            detail=(
                f"rule references street '{rule_street_name}' but the PDF's streets "
                "list does not contain that name — rule does not apply to this lot"
            ),
        )

    fronts = _front_classifications(classifications)
    if not fronts:
        return AppliedRule(
            rule_index=rule_index,
            rule_type="setback_override",
            raw_text=raw_text,
            status=STATUS_NO_MATCH,
            detail="lot has no front edges — rule cannot apply",
        )

    if len(fronts) > 1:
        # Option 1: surface to reviewer rather than guessing.
        return AppliedRule(
            rule_index=rule_index,
            rule_type="setback_override",
            raw_text=raw_text,
            status=STATUS_AMBIGUOUS_NEEDS_REVIEW,
            detail=(
                f"lot has {len(fronts)} front edges; rule references street "
                f"'{rule_street_name}' but we don't auto-pick which front edge it "
                "applies to. Reviewer must assign manually."
            ),
        )

    edge = fronts[0]
    old_value = edge.required_setback_m
    edge.required_setback_m = value_m
    return AppliedRule(
        rule_index=rule_index,
        rule_type="setback_override",
        raw_text=raw_text,
        status=STATUS_APPLIED,
        detail=(
            f"front edge #{edge.edge_idx} setback overridden: "
            f"{old_value:.3f} → {value_m:.3f} m (street '{rule_street_name}')"
        ),
        affected_edge_indices=[edge.edge_idx],
    )


def _apply_side_reclassification(
    rule: dict,
    classifications: list[EdgeClassification],
    lot: Polygon,
    side_to_required: dict[str, float],
    rule_index: int,
) -> AppliedRule:
    """Reclassify edges per the rule's effect when the condition matches."""
    cond = rule.get("condition") or {}
    eff = rule.get("effect") or {}
    raw_text = str(rule.get("raw_text") or "")

    if str(cond.get("kind") or "").lower() != "street_count":
        return AppliedRule(
            rule_index=rule_index,
            rule_type="side_reclassification",
            raw_text=raw_text,
            status=STATUS_UNRECOGNIZED,
            detail=f"condition.kind={cond.get('kind')!r} not supported",
        )

    matches, detail = _evaluate_street_count_condition(cond, classifications)
    if not matches:
        return AppliedRule(
            rule_index=rule_index,
            rule_type="side_reclassification",
            raw_text=raw_text,
            status=STATUS_SKIPPED_CONDITION_FALSE,
            detail=detail,
        )

    reclassify_steps = eff.get("reclassify") or []
    affected: list[int] = []
    descriptions: list[str] = []
    for step in reclassify_steps:
        if not isinstance(step, dict):
            continue
        target = str(step.get("target") or "")
        new_side = str(step.get("new_side") or "")
        idxs = _resolve_reclassify_target(target, classifications, lot)
        if not idxs:
            descriptions.append(f"'{target}' resolved to no edges")
            continue
        for idx in idxs:
            for c in classifications:
                if c.edge_idx == idx:
                    old_side = c.side
                    c.side = new_side
                    if new_side in side_to_required:
                        c.required_setback_m = side_to_required[new_side]
                    affected.append(idx)
                    descriptions.append(
                        f"edge #{idx}: {old_side} → {new_side}"
                    )

    if not affected:
        return AppliedRule(
            rule_index=rule_index,
            rule_type="side_reclassification",
            raw_text=raw_text,
            status=STATUS_NO_MATCH,
            detail=f"condition matched ({detail}) but no edges resolved for the targets",
        )

    return AppliedRule(
        rule_index=rule_index,
        rule_type="side_reclassification",
        raw_text=raw_text,
        status=STATUS_APPLIED,
        detail="; ".join(descriptions),
        affected_edge_indices=affected,
    )


def apply_special_provisions(
    classifications: Sequence[EdgeClassification],
    rules: Sequence[dict],
    pdf_streets: Sequence[dict],
    lot: Polygon,
    side_to_required: dict[str, float],
) -> SpecialProvisionsResult:
    """Apply الاحكام الخاصة on top of an already-classified lot.

    Args:
      classifications  — output of street_classifier.classify_edges.
      rules            — `site_plan_result["special_provisions"]` (already
                         normalised by site_plan_extractor._normalize).
      pdf_streets      — `site_plan_result["streets"]`. Used to confirm
                         that a rule's named street is actually on this lot.
      lot              — shapely Polygon for "opposite edge" lookups.
      side_to_required — {"front": Xm, "side": Ym, "rear": Zm} from the PDF
                         table. Used to reset required_setback_m when an
                         edge changes side via reclassification.

    Returns a SpecialProvisionsResult — never mutates the input list.
    """
    cls_list: list[EdgeClassification] = [
        EdgeClassification(**asdict(c)) for c in classifications
    ]
    applied: list[AppliedRule] = []
    notes: list[str] = []

    for idx, rule in enumerate(rules or []):
        rule_type = str(rule.get("type") or "").lower()
        if rule_type == "setback_override":
            entry = _apply_setback_override(rule, cls_list, pdf_streets, idx)
        elif rule_type == "side_reclassification":
            entry = _apply_side_reclassification(
                rule, cls_list, lot, side_to_required, idx
            )
        else:
            entry = AppliedRule(
                rule_index=idx,
                rule_type=rule_type or "unrecognized",
                raw_text=str(rule.get("raw_text") or ""),
                status=STATUS_UNRECOGNIZED,
                detail=str(rule.get("reason") or "rule shape not recognized — needs reviewer"),
            )
        applied.append(entry)
        if entry.status in {STATUS_AMBIGUOUS_NEEDS_REVIEW, STATUS_UNRECOGNIZED}:
            notes.append(
                f"rule #{idx} ({entry.rule_type}): {entry.status} — {entry.detail}"
            )

    return SpecialProvisionsResult(
        classifications=cls_list,
        applied_rules=applied,
        notes=notes,
    )
