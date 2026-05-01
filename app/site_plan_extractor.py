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
