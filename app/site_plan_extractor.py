"""AI-powered extractor for "مخطط موقع تنظيمي" — the regulatory site plan
PDF that carries the minimum allowed setbacks (front / side / rear) for a
permit application.

Independent asyncio task on the same SSE stream as deed/floor pipelines.
Emits site_plan_start → site_plan_done / site_plan_error. Writes results to
job.site_plan_result. Never raises.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import traceback
from typing import Any

import anthropic

from app.jobs import Job
from app.validation import (
    MD_SITE_PLAN_UNREADABLE,
    MD_SITE_PLAN_WRONG_DOC,
)


def _log(msg: str) -> None:
    """Windows-cp1252-safe stdout log. Never raises."""
    try:
        sys.stdout.write(msg + "\n")
        sys.stdout.flush()
    except Exception:
        try:
            sys.stdout.write(msg.encode("ascii", errors="replace").decode("ascii") + "\n")
            sys.stdout.flush()
        except Exception:
            pass


SITE_PLAN_SYSTEM_PROMPT = """You are analyzing an Arabic regulatory site-plan PDF titled "مخطط موقع تنظيمي" issued by a Jordanian municipality (typically أمانة عمّان الكبرى). It carries the zoning rules that govern a specific lot — most importantly the minimum allowed building setbacks.

Your job is to read the values printed on the document EXACTLY as written. Never invent, never round, never substitute typical defaults.

════════════════════════════════════════════════════
DOCUMENT TYPE CHECK — DO THIS FIRST
════════════════════════════════════════════════════

Look at the page header. If the title is NOT "مخطط موقع تنظيمي" (or a near-identical regulatory-site-plan title from a Jordanian municipality), return:

  {"is_site_plan": false, "reject_reason": "<short Arabic-or-English reason describing what the document actually appears to be>"}

and stop. Do NOT try to extract setbacks from the wrong document type.

If the title matches, set "is_site_plan": true and proceed.

════════════════════════════════════════════════════
SETBACK VALUES — THE CORE EXTRACTION
════════════════════════════════════════════════════

The setback values live in a table under the column header "الارتدادات (متر)". That column is split into three sub-columns labelled (right-to-left in Arabic):

  • امامي  → front_setback_m  (the side that faces the street)
  • جانبي  → side_setback_m   (the side setback)
  • خلفي   → rear_setback_m   (the rear / opposite-of-street setback)

Read each value as a positive number in METRES. The document uses Western digits (10, 4, 6) but be ready to handle Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) just in case.

CORNER LOTS — when the lot fronts TWO streets, the document will list ONLY two setback values: front (امامي) and side (جانبي), with NO rear (خلفي) value. In that case:
  • "rear_setback_m": null
  • "is_corner_lot": true

Otherwise (all three values present):
  • "is_corner_lot": false

If you cannot find the front or side values, return:
  {"is_site_plan": true, "extraction_failed": true, "reason": "<short reason — which fields were missing or unreadable>"}

════════════════════════════════════════════════════
SECONDARY FIELDS — extract when present, null when absent
════════════════════════════════════════════════════

Lot identity (used to cross-check against the deed PDF):
  • رقم القطعة            → plot_number    (string)
  • اسم ورقم الحوض        → basin          (string, verbatim — e.g. "5 الحنو")
  • اسم ورقم القرية        → village        (string, verbatim — e.g. "142 اليادودة")
  • رقم الحي               → neighborhood   (string)

Zoning + envelope — these live in the SAME احكام table as the setbacks above. Each is its own column. Reading right-to-left, after الارتدادات you will typically encounter:

  • الاستعمال              → use_type                  (verbatim Arabic — the leftmost/rightmost edge column carrying the zone name, e.g. "سكن اخضر ب باحكام خاصة")
  • النسبة المئوية (%)     → coverage_pct              (the building footprint coverage limit, e.g. 33)
  • عدد الادوار            → max_floors                (integer floor count, e.g. 2)
  • ارتفاع البناء (م)      → max_height_m              (e.g. 8)
  • الحد الادنى للواجهة الامامية (م) → min_front_facade_m  (e.g. 35)
  • الحد الادنى لمساحة الافراز (م2)  → min_parcel_area_m2  (e.g. 1500)
  • النسبة الطابقية (%)    → floor_ratio_pct           (the FLOOR-AREA ratio limit — a separate column from النسبة المئوية, normally one of the leftmost columns of the احكام table, e.g. 35. This column is almost always present; only return null if you genuinely cannot see this column on the page.)

These columns may appear in any order across municipalities — match by header label, not by position. Both النسبة المئوية and النسبة الطابقية are percentage columns and easy to confuse: النسبة المئوية = building footprint coverage; النسبة الطابقية = total floor-area coverage (usually larger because it sums all floors).

Address fields (extract when printed on the site plan; null otherwise):
  • اسم الشارع / الشارع    → street_name     (string, verbatim Arabic)
  • رقم البناية            → building_number (string)

════════════════════════════════════════════════════
STREETS — list every street that touches the highlighted lot
════════════════════════════════════════════════════

The site plan typically shows a small GIS-style map with the lot highlighted, and surrounding streets either labelled inside that map (like a road map) or named in nearby text (e.g. "الواجهة على شارع X"). List EVERY street that touches the highlighted lot — even if it has no visible name.

For each street return:
  • name     — verbatim Arabic name, OR null if the street is drawn but unlabelled
  • position — where the street sits relative to the highlighted lot in the GIS view, expressed as a cardinal direction. The GIS view in this document is ALWAYS drawn with NORTH at the TOP of the page. One of:
                  "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest"
  • raw_source — short phrase saying where you read the name (e.g. "GIS view label", "explicit text near the table", "unlabeled road outline")

Returns an array. Empty array if you genuinely cannot identify any streets.

════════════════════════════════════════════════════
احكام خاصة (special provisions) — overrides to the table values
════════════════════════════════════════════════════

After the main احكام table, the document may carry one or more additional rules under a heading like "الاحكام الخاصة" (also written "أحكام خاصة" / "ملاحظات"). These OVERRIDE the default table values when their condition matches the lot. A rule whose condition does not match (e.g. it references a street not on this lot) is silently ignored at apply time.

Classify each rule into ONE of these three types — pick the BEST FIT and use the matching condition + effect shape. If no shape fits, use type="unrecognized" and dump the raw Arabic so a reviewer can read it.

────────────────────────────────────────
TYPE A — "setback_override"
   The rule sets a specific setback value on the side facing a particular named street.
────────────────────────────────────────

   condition: {"kind": "street_name", "street_name": "<verbatim Arabic name>"}

   effect: {"target_side": "front" | "side" | "rear", "value_m": <number>}

   Example rule text: "إذا كانت الواجهة على شارع عبدالله غوشة فيكون الارتداد الامامي 8 متر"
   Structured as:
   {
     "type": "setback_override",
     "condition": {"kind": "street_name", "street_name": "شارع عبدالله غوشة"},
     "effect": {"target_side": "front", "value_m": 8},
     "raw_text": "إذا كانت الواجهة على شارع عبدالله غوشة فيكون الارتداد الامامي 8 متر"
   }

────────────────────────────────────────
TYPE B — "side_reclassification"
   The rule changes which lot edges count as front / side / rear based on a condition like the number of streets the lot fronts. It does NOT change the setback values themselves; it changes which side category each edge belongs to.
────────────────────────────────────────

   condition: {"kind": "street_count", "operator": "==" | ">=" | "<=", "value": <integer>}

   effect: {"reclassify": [
       {"target": "<descriptor>", "new_side": "front" | "side" | "rear"},
       ...
   ]}

   target descriptors supported:
     • "non_front_edge"               — the single lot edge that does NOT face a street
     • "edge_opposite_to_non_front"   — the lot edge directly opposite the non-front edge
     • "all_front_edges"              — every street-facing edge
     • "all_side_edges"               — every edge currently classified as side
     • "all_rear_edges"               — every edge currently classified as rear

   Example rule text: "إذا كانت القطعة على ثلاثة شوارع، فإن الجهة غير المطلة على شارع تعتبر جانبية والجهة المقابلة لها تعتبر جانبية ايضا"
   Structured as:
   {
     "type": "side_reclassification",
     "condition": {"kind": "street_count", "operator": "==", "value": 3},
     "effect": {"reclassify": [
         {"target": "non_front_edge",             "new_side": "side"},
         {"target": "edge_opposite_to_non_front", "new_side": "side"}
     ]},
     "raw_text": "..."
   }

────────────────────────────────────────
TYPE C — "unrecognized"
   The rule says something that doesn't fit either of the shapes above (e.g. it changes height, coverage, or asks for a calculation we can't automate). Return only the raw text and a one-line English description.
────────────────────────────────────────

   {
     "type": "unrecognized",
     "raw_text": "<verbatim Arabic>",
     "reason": "<short English description of what the rule is about>"
   }

If the الاحكام الخاصة block is absent, return an empty array. ALSO return the entire raw block verbatim as `special_provisions_raw_text` so a reviewer can verify nothing was missed; empty string if no block.

════════════════════════════════════════════════════
OUTPUT
════════════════════════════════════════════════════

Return ONLY a valid JSON object. No surrounding text, no markdown fence.

Successful extraction:
{
  "is_site_plan": true,
  "front_setback_m": 10,
  "side_setback_m": 4,
  "rear_setback_m": 6,
  "is_corner_lot": false,
  "plot_number": "780",
  "basin": "5 الحنو",
  "village": "142 اليادودة",
  "neighborhood": "الاندلس",
  "use_type": "سكن اخضر ب باحكام خاصة",
  "coverage_pct": 33,
  "floor_ratio_pct": 35,
  "max_floors": 2,
  "max_height_m": 8,
  "min_front_facade_m": 35,
  "min_parcel_area_m2": 1500,
  "street_name": "...",
  "building_number": "...",
  "streets": [
    {"name": "شارع عبدالله غوشة", "position": "north", "raw_source": "GIS view label"},
    {"name": null,                "position": "east",  "raw_source": "unlabeled road outline"}
  ],
  "special_provisions": [
    {
      "type": "setback_override",
      "condition": {"kind": "street_name", "street_name": "شارع عبدالله غوشة"},
      "effect": {"target_side": "front", "value_m": 8},
      "raw_text": "إذا كانت الواجهة على شارع عبدالله غوشة فيكون الارتداد الامامي 8 متر"
    }
  ],
  "special_provisions_raw_text": "<full verbatim block, or empty string if absent>",
  "summary": "<2-3 sentence English summary of the site plan>"
}

Wrong document type:
{"is_site_plan": false, "reject_reason": "..."}

Site plan but setbacks unreadable:
{"is_site_plan": true, "extraction_failed": true, "reason": "..."}
"""


# Arabic-Indic digits → ASCII digits.
_ARABIC_DIGITS_MAP = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


def _coerce_float(v: Any) -> float | None:
    """Coerce a JSON value to a positive float; handle Arabic-Indic digits."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.translate(_ARABIC_DIGITS_MAP)
        s = s.replace("\u066B", ".").replace("\u066C", ",").replace(",", "").strip()
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                return None
    return None


def _coerce_int(v: Any) -> int | None:
    f = _coerce_float(v)
    return int(round(f)) if f is not None else None


_VALID_CARDINAL_POSITIONS = frozenset({
    "north", "south", "east", "west",
    "northeast", "northwest", "southeast", "southwest",
})

_VALID_SIDES = frozenset({"front", "side", "rear"})

_VALID_RECLASS_TARGETS = frozenset({
    "non_front_edge",
    "edge_opposite_to_non_front",
    "all_front_edges",
    "all_side_edges",
    "all_rear_edges",
})

_VALID_COUNT_OPERATORS = frozenset({"==", ">=", "<="})


def _normalize_street(raw: Any) -> dict | None:
    """Coerce one street entry. Returns None if the input isn't usable."""
    if not isinstance(raw, dict):
        return None
    name_raw = raw.get("name")
    name = name_raw.strip() if isinstance(name_raw, str) and name_raw.strip() else None
    pos_raw = raw.get("position")
    pos = (str(pos_raw).strip().lower() if pos_raw else None)
    if pos not in _VALID_CARDINAL_POSITIONS:
        pos = None
    return {
        "name": name,
        "position": pos,
        "raw_source": str(raw.get("raw_source") or "").strip(),
    }


def _normalize_special_provision(raw: Any) -> dict:
    """Coerce one special-provision rule into a known shape.

    Returns one of:
      - setback_override   — condition.kind=street_name, effect carries target_side+value_m
      - side_reclassification — condition.kind=street_count, effect carries reclassify list
      - unrecognized       — fallback for malformed/unknown rules; raw_text + reason

    Always returns a dict (never None) — the caller stores the full list so
    nothing extracted by Claude is silently dropped.
    """
    if not isinstance(raw, dict):
        return {
            "type": "unrecognized",
            "raw_text": str(raw or ""),
            "reason": "rule was not a JSON object",
        }

    rule_type = str(raw.get("type") or "").strip().lower()
    raw_text = str(raw.get("raw_text") or "").strip()

    if rule_type == "setback_override":
        cond = raw.get("condition") or {}
        eff = raw.get("effect") or {}
        kind = str(cond.get("kind") or "").lower()
        target_side = str(eff.get("target_side") or "").lower()
        value_m = _coerce_float(eff.get("value_m"))
        street_name = str(cond.get("street_name") or "").strip()
        if (
            kind == "street_name"
            and target_side in _VALID_SIDES
            and value_m is not None
            and street_name
        ):
            return {
                "type": "setback_override",
                "condition": {"kind": "street_name", "street_name": street_name},
                "effect": {"target_side": target_side, "value_m": value_m},
                "raw_text": raw_text,
            }
        return {
            "type": "unrecognized",
            "raw_text": raw_text,
            "reason": "setback_override rule is missing or malformed required fields",
        }

    if rule_type == "side_reclassification":
        cond = raw.get("condition") or {}
        eff = raw.get("effect") or {}
        kind = str(cond.get("kind") or "").lower()
        operator = str(cond.get("operator") or "==").strip()
        if operator not in _VALID_COUNT_OPERATORS:
            operator = "=="
        value = _coerce_int(cond.get("value"))
        reclassify_in = eff.get("reclassify")
        norm_reclass: list[dict] = []
        if isinstance(reclassify_in, list):
            for r in reclassify_in:
                if not isinstance(r, dict):
                    continue
                target = str(r.get("target") or "").lower()
                new_side = str(r.get("new_side") or "").lower()
                if target in _VALID_RECLASS_TARGETS and new_side in _VALID_SIDES:
                    norm_reclass.append({"target": target, "new_side": new_side})
        if kind == "street_count" and value is not None and norm_reclass:
            return {
                "type": "side_reclassification",
                "condition": {"kind": "street_count", "operator": operator, "value": value},
                "effect": {"reclassify": norm_reclass},
                "raw_text": raw_text,
            }
        return {
            "type": "unrecognized",
            "raw_text": raw_text,
            "reason": "side_reclassification rule is missing or malformed required fields",
        }

    # Explicit unrecognized OR unknown type — preserve raw_text + reason.
    return {
        "type": "unrecognized",
        "raw_text": raw_text,
        "reason": str(raw.get("reason") or "rule shape not recognized").strip(),
    }


def _parse_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from Claude's response text."""
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```\s*$", "", s)
    m = re.search(r"\{[\s\S]*\}", s)
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {"parse_error": True, "raw": text or "(empty response)"}


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    """Coerce numeric fields and validate the structural invariants the
    downstream geometry code depends on.

    Returns a dict with these well-defined cases (the caller branches on them):
      • {"status": "ok",                front, side, rear, is_corner, ...}
      • {"status": "wrong_document",    reason}
      • {"status": "extraction_failed", reason}
    """
    if raw.get("parse_error"):
        return {"status": "extraction_failed",
                "reason": f"Claude response was not valid JSON. Preview: "
                          f"{(raw.get('raw') or '')[:200]!r}"}

    if raw.get("is_site_plan") is False:
        return {"status": "wrong_document",
                "reason": str(raw.get("reject_reason") or
                              "PDF is not a 'مخطط موقع تنظيمي' regulatory site plan.")}

    if raw.get("extraction_failed"):
        return {"status": "extraction_failed",
                "reason": str(raw.get("reason") or
                              "Could not read setback values from the site plan.")}

    front = _coerce_float(raw.get("front_setback_m"))
    side = _coerce_float(raw.get("side_setback_m"))
    rear = _coerce_float(raw.get("rear_setback_m"))
    is_corner = bool(raw.get("is_corner_lot"))

    # Corner-lot sanity: PDF says corner ⇒ rear must be null.
    # Non-corner ⇒ all three present.
    if front is None or side is None:
        return {"status": "extraction_failed",
                "reason": "Front (امامي) and side (جانبي) setbacks are both "
                          "required but at least one is missing from the PDF."}

    if not is_corner and rear is None:
        # Treat as corner if rear truly absent — but flag it so the side
        # classifier can verify against the geometry.
        is_corner = True

    out = {
        "status": "ok",
        "front_setback_m": front,
        "side_setback_m": side,
        "rear_setback_m": rear if not is_corner else None,
        "is_corner_lot": is_corner,
        "plot_number": (raw.get("plot_number") or None),
        "basin": (raw.get("basin") or None),
        "village": (raw.get("village") or None),
        "neighborhood": (raw.get("neighborhood") or None),
        "use_type": (raw.get("use_type") or None),
        "coverage_pct": _coerce_float(raw.get("coverage_pct")),
        "floor_ratio_pct": _coerce_float(raw.get("floor_ratio_pct")),
        "max_floors": _coerce_int(raw.get("max_floors")),
        "max_height_m": _coerce_float(raw.get("max_height_m")),
        "min_front_facade_m": _coerce_float(raw.get("min_front_facade_m")),
        "min_parcel_area_m2": _coerce_float(raw.get("min_parcel_area_m2")),
        "street_name": (raw.get("street_name") or None),
        "building_number": (raw.get("building_number") or None),
        "summary": str(raw.get("summary") or ""),
    }

    # ---- Streets surrounding the lot (for special-provisions matching) ----
    streets_in = raw.get("streets")
    streets_out: list[dict] = []
    if isinstance(streets_in, list):
        for s in streets_in:
            entry = _normalize_street(s)
            if entry is not None:
                streets_out.append(entry)
    out["streets"] = streets_out

    # ---- Special provisions (الاحكام الخاصة) ----
    sp_in = raw.get("special_provisions")
    sp_out: list[dict] = []
    if isinstance(sp_in, list):
        for r in sp_in:
            sp_out.append(_normalize_special_provision(r))
    out["special_provisions"] = sp_out
    out["special_provisions_raw_text"] = str(raw.get("special_provisions_raw_text") or "").strip()

    return out


async def extract_site_plan_data(
    pdf_bytes: bytes, api_key: str, model: str = "claude-opus-4-7"
) -> dict[str, Any]:
    """Pure extraction — no Job, no SSE. Used by the CLI and by analyze_site_plan.

    Returns the normalized dict (with `status` ∈ {"ok", "wrong_document",
    "extraction_failed", "error"}), including a `raw_response` field for
    auditing.
    """
    t0 = time.perf_counter()
    _log(f"[site-plan] -> Claude call ({len(pdf_bytes):,} bytes, model={model})")

    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=90.0, max_retries=1)
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")
    response = await client.messages.create(
        model=model,
        max_tokens=2048,
        system=SITE_PLAN_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Extract the regulatory setbacks and identifying "
                            "fields per your system instructions. Return ONLY "
                            "valid JSON."
                        ),
                    },
                ],
            }
        ],
    )

    text = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text += block.text
    dt = time.perf_counter() - t0
    _log(f"[site-plan] <- Claude returned {len(text)} chars in {dt:.1f}s")

    raw = _parse_json(text)
    data = _normalize(raw)
    data["raw_response"] = raw if not raw.get("parse_error") else None
    return data


async def analyze_site_plan(job: Job, pdf_bytes: bytes, cfg: dict) -> None:
    """Run Claude on the site-plan PDF, normalize the result, emit
    site_plan_start → site_plan_done / site_plan_error. Never raises.
    """
    agent_cfg = cfg.get("agent", {})
    api_key_env = agent_cfg.get("api_key_env", "ANTHROPIC_API_KEY")
    api_key = os.environ.get(api_key_env)
    model = agent_cfg.get("model", "claude-opus-4-7")

    if not api_key:
        msg = f"{api_key_env} env var is not set"
        job.site_plan_result = {"status": "error", "error": msg}
        await job.emit("site_plan_error", message=msg)
        return

    await job.emit("site_plan_start", model=model, bytes=len(pdf_bytes))

    try:
        data = await extract_site_plan_data(pdf_bytes, api_key, model)
        job.site_plan_result = data

        public = {k: v for k, v in data.items() if k != "raw_response"}
        if data["status"] == "ok":
            await job.emit("site_plan_done", **public)
        elif data["status"] == "wrong_document":
            # Site plan failure is no longer a hard halt — it's a content
            # issue surfaced on the review panel. The compliance step will
            # simply be skipped; the reviewer returns the application to the
            # submitter for the correct document.
            # NOTE: payload key is `category` (not `kind`) — Job.emit takes
            # kind as its first positional arg, and the SSE serializer
            # strips the top-level `kind` field before sending, so the
            # frontend would never see a payload `kind` even if we could
            # pass it. Frontend reads payload.category to branch on the
            # specific failure subtype.
            await job.emit("site_plan_error", reason=data["reason"], category="wrong_document")
            await job.record_missing_data(MD_SITE_PLAN_WRONG_DOC)
        else:
            await job.emit("site_plan_error", reason=data["reason"], category="extraction_failed")
            await job.record_missing_data(MD_SITE_PLAN_UNREADABLE)

    except Exception as e:
        _log(f"[site-plan] FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
        msg = f"{type(e).__name__}: {e}"
        job.site_plan_result = {"status": "error", "error": msg}
        await job.emit("site_plan_error", message=msg, category="exception")
