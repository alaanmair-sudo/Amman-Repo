"""AI-powered floor-plan-area PDF analyzer — "خطة مساحة الطابقية".

Scope (per user): one job — extract the engineer's per-floor breakdown tables
exactly as printed, then verify for every row that `dim × qty × sign` computed
in Python matches the printed row total. No subtotal checks. No grand-total
checks. No classification. Just row-by-row math.

    PDF ──(Claude)──▶  rows[{dims, sign, qty, total_printed}]
                     │
                     ▼
           Python: per-row dim × qty × sign
                     │
                     ▼
        compare vs sign × total_printed
          flag row if |Δ| > 1.0 m²

Subtotals and the building grand total are extracted for display only — the
engineer's numbers are trusted as-is. No reconciliation chain.

Fully independent of the CAD pipeline and deed-PDF pipeline: its own asyncio
task, its own AsyncAnthropic client. Emits floor_start / floor_done /
floor_error on the shared SSE stream.
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


FLOOR_SYSTEM_PROMPT = """You are analyzing an Arabic architectural floor-area plan PDF titled "خطة مساحة الطابقية". It's a license/permit application for a new building or an addition. Your job is to extract EXACTLY what is printed on the page so it can be audited — never reconcile, never round, never invent.

THE BUILDING IS DIVIDED INTO "FLOORS" OR "BLOCKS". Names vary widely: "الطابق الأرضي", "الطابق الأول", "طابق التسوية", "السطح", "مكرر الدرج", "مساحة المحول", "غرف الماكنيات", "مخطط مساحات البناء الفرعي", etc. — each one is its own entry in the "floors" array.

Each floor/block has its own area breakdown, which may be:
  • A table with rows, OR
  • Free-form text next to a shape drawing — e.g. a box labelled "مساحة المحول = 5.00 × 6.00 = 30.00 م²" (treat that as a single-row floor).

IGNORE these — they are NOT floors:
  • Title blocks, scale bars, north arrows, engineer signature blocks.
  • Revision / modification tables ("جدول التعديلات", "جدول تعديلات", "جدول الملاحظات").
  • The building-level SUMMARY table that lists every floor's total and the grand total. That is the source for "printed_grand_total" below — do NOT also emit it as a floor.

NEVER copy rows from one floor's breakdown into another floor's "rows" list. Two small tables sitting near each other on the same page do NOT share rows.

Read numbers EXACTLY as printed. If the dims look like "2.53 × 11.06" but the printed total says 22.45, report BOTH verbatim — do NOT change the dim and do NOT change the total. The downstream row-by-row check will catch the mismatch.

════════════════════════════════════════════════════
ROW SPEC
════════════════════════════════════════════════════

REQUIRED fields for every row:
  • "dims"           — the literal dimensions string, verbatim as printed.
                       Examples:
                         "6.70 X 6.70", "5.00 × 6.00",
                         "9.41 + 9.15 × 5.50 × 0.50",
                         "4.80 × 3.20 + 2.10 × 1.40",
                         "By AutoCAD", "By CAD"
                       Do NOT normalise X/× case or spacing.
  • "total_printed"  — the row's TOTAL contribution in m², POSITIVE JSON
                       number. If the table has both a per-unit "المساحة م²"
                       column and a "المساحة الكلية" column, "total_printed"
                       is the المساحة الكلية value (already = qty × per-unit).
                       If there is only one area column, use that value.
                       The sign goes in "sign", never on this number.
  • "sign"           — exactly "+" or "-". Sign may appear in its own column
                       (الاشارة) OR as a prefix on the المساحة الكلية number.
                       Blank cell → "+".

OPTIONAL:
  • "qty"  — integer ≥ 1, from the "العدد" column. Include it whenever that
             column exists and qty > 1; omit otherwise. When qty > 1, the
             "total_printed" value ALREADY includes the multiplication.
  • "no"   — the row number as printed (1, 2, 3, …) if available.

NUMBERS — Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩, decimal "٫", thousands "٬") must be
converted to plain Western-digit JSON numbers in your output.

════════════════════════════════════════════════════
FLOOR SPEC
════════════════════════════════════════════════════

REQUIRED for every floor:
  • "name"              — Arabic name verbatim, no transliteration.
  • "rows"              — every row of the breakdown, in order.
  • "printed_subtotal"  — the sum printed at the bottom of that floor's
                          breakdown, POSITIVE number. null if absent.
                          Display-only — we do not verify it.

OPTIONAL:
  • "page"  — 1-indexed page number where this floor's breakdown appears.
  • "qty"   — integer ≥ 1. Set ONLY when ONE breakdown explicitly represents
              N identical floors (e.g. "مكرر ×3"). Default 1. The downstream
              code handles any repetition; do NOT multiply row values.

════════════════════════════════════════════════════
BUILDING-LEVEL FIELDS
════════════════════════════════════════════════════

From the building-level summary table (the one you were told to IGNORE as a
floor), extract:

  • "printed_grand_total" — the grand total printed there (usually labelled
                            "المجموع" or "مجموع المساحات"). null if absent.
                            Display-only.
  • "licensed_total"      — "مجموع المساحة المراد ترخيصها" /
                            "مجموع المساحة المراد ترخيصه". Display-only.
                            null if absent.
  • "num_floors"          — integer. The count of NUMBERED UPPER FLOORS
                            in the building.

                            ALGORITHM (apply to every entry in "floors"
                            you already extracted — do NOT re-classify
                            from the page, use the names verbatim):

                            STEP 1 — REJECT FIRST. If the entry's name
                            contains ANY of the following substrings,
                            do NOT count it, regardless of whether an
                            ordinal word (الأول / الثاني / ...) also
                            appears somewhere in the name:
                              • التسوية             (basement / sub-level —
                                e.g. "الطابق التسوية الثانية" → REJECT)
                              • السطح                 (roof / roof room)
                              • مكرر الدرج           (stair repeat)
                              • المحول / الماكينات / الماكنيات  (transformer, mechanical)
                              • الحارس                (guard room)
                              • بئر                    (water well / shaft)
                              • السقف الداعم         (supporting roof slab)
                              • الأدراج المعلقة      (suspended stairs)
                              • البناء الفرعي        (sub-plan / secondary-area sheet)
                              • مخطط, ملخص, المجموع (summary / total tables)

                            STEP 2 — For entries that survived Step 1,
                            add to the count as follows (otherwise
                            SKIP):

                              (a) Name matches "الطابق ال<ordinal>"
                                  where <ordinal> ∈ {الأول / الاول,
                                  الثاني, الثالث, الرابع, الخامس,
                                  السادس, السابع, الثامن, التاسع,
                                  العاشر, الحادي عشر, …}  →  add 1.

                              (b) Name is a REPETITION LABEL standing
                                  in for numbered upper floors (e.g.
                                  "مكرر الطوابق المتكررة" or a named
                                  typical-floor-repeat) AND has a
                                  non-null "qty" field, AND the PDF's
                                  context makes clear the repeats ARE
                                  numbered upper floors (not
                                  sub-components)  →  add qty.

                              (c) Name contains الأرضي or الارضي
                                  (ground floor) — accepts both the
                                  full form "الطابق الأرضي القائم A"
                                  and the bare form "الأرضي" since
                                  some PDFs drop the "الطابق" prefix.
                                  →  add 1.

                            Everything else → SKIP.

                            num_floors = sum of all added counts.
                            Return null only if the PDF is unreadable
                            or no entry / summary table mentions any
                            numbered upper floor anywhere.

════════════════════════════════════════════════════
OUTPUT
════════════════════════════════════════════════════

Return ONLY a valid JSON object — no surrounding text, no markdown fence.

{
  "floors": [
    {
      "name": "الطابق الأول",
      "page": 3,
      "rows": [
        {"no": 1, "dims": "29.60 X 39.55", "sign": "+", "total_printed": 1170.68},
        {"no": 5, "dims": "1.50 X 1.60",   "sign": "-", "qty": 2, "total_printed": 4.80},
        {"no": 4, "dims": "By AutoCAD",    "sign": "+", "total_printed": 75.36}
      ],
      "printed_subtotal": 1008.56
    },
    {
      "name": "مكرر الطوابق المتكررة",
      "qty": 3,
      "page": 4,
      "rows": [
        {"no": 1, "dims": "10.00 X 13.60", "sign": "+", "total_printed": 136.00}
      ],
      "printed_subtotal": 136.00
    }
  ],
  "printed_grand_total": 4864.23,
  "licensed_total": 550.88,
  "num_floors": 4
}
"""


# Per-row tolerance: fixed 1.0 m² per user spec. A row is flagged iff its dims
# are parseable AND |signed_python - signed_printed| > ROW_TOLERANCE_M2.
ROW_TOLERANCE_M2 = 1.0


# Substrings that disqualify a floor-entry from the count — if any appears
# in the entry's name, skip it regardless of whether a floor keyword also
# shows up somewhere in the label. Note: الأرضي / الارضي are NOT rejected —
# the ground floor is counted as a full floor. "مخطط" is also not rejected,
# because valid entries like "مخطط مساحة الطابق الارضي القائم A" still
# represent real ground floors; sub-plans are filtered via "البناء الفرعي"
# specifically.
_NUM_FLOORS_REJECT = (
    "التسوية",
    "السطح",
    "مكرر الدرج",
    "المحول",
    "الماكينات", "الماكنيات", "الماكينيات",
    "الحارس",
    "بئر",
    "السقف الداعم",
    "الأدراج المعلقة", "الدراج المعلقة",
    "البناء الفرعي",
    "ملخص", "المجموع",
)

# Ground-floor markers. Either spelling (with/without hamza) counts as the
# same single "ground" category.
_NUM_FLOORS_GROUND = ("الأرضي", "الارضي")

# Ordinal markers that indicate a numbered upper floor. Both الأول (with hamza)
# and الاول (without hamza) variants accepted — PDFs are inconsistent.
_NUM_FLOORS_ORDINALS = (
    "الأول", "الاول",
    "الثاني",
    "الثالث",
    "الرابع",
    "الخامس",
    "السادس",
    "السابع",
    "الثامن",
    "التاسع",
    "العاشر",
    "الحادي عشر", "الحادى عشر",
    "الثاني عشر",
)


def _compute_num_floors(floors: list[dict[str, Any]]) -> int | None:
    """Return the count of DISTINCT LOGICAL FLOORS in the building — the
    ground floor plus any numbered upper floors (الطابق الأول / الثاني / …).

    Deterministic; the LLM can't be trusted to apply the inclusion/exclusion
    rules reliably, so we categorize here in Python. Distinct floor
    CATEGORIES are collected in a set so multi-sheet entries (e.g. the
    ground floor split into "... القائم A" and "... القائم B") collapse
    to one count.

      1. Skip any entry whose name contains a _NUM_FLOORS_REJECT keyword
         (basements, stairs, mechanical rooms, sub-plans, summary tables).
         Exclusion beats inclusion — compound names like
         "الطابق التسوية الثانية" (contains both التسوية AND an ordinal) are
         still rejected because التسوية matches first.
      2. Classify each survivor into exactly one category:
           • ground   — name has "الطابق" + any _NUM_FLOORS_GROUND marker.
           • <ordinal> — name has "الطابق" + one of the ordinal markers.
           • repetition — name has "مكرر" + "الطوابق"; emits `qty` unique
             tokens (one per repeated floor) so they don't collapse.
         Each category is added to a set.
      3. num_floors = len(set). A/B plan-sheet splits land in the same
         category and only count once. Multiple sheets of "الطابق الاول"
         also collapse to one first floor.

    Returns None when the floors list is missing / empty.
    """
    if not floors:
        return None
    categories: set[str] = set()
    repeat_idx = 0
    for f in floors:
        if not isinstance(f, dict):
            continue
        name = (f.get("name") or "").strip()
        if not name:
            continue
        # Step 1: reject first — exclusion beats inclusion.
        if any(kw in name for kw in _NUM_FLOORS_REJECT):
            continue
        # Step 2a: ground floor. Accepts both the full form ("الطابق الأرضي")
        # and the bare form ("الأرضي" / "الارضي") since some PDFs drop the
        # "الطابق" prefix on the ground floor entry.
        if any(g in name for g in _NUM_FLOORS_GROUND):
            categories.add("ground")
            continue
        # Step 2b: numbered upper floor — key the category by the matched
        # ordinal so "الطابق الاول A" + "الطابق الاول B" collapse. Requires
        # "الطابق" to avoid false positives on stray ordinal words.
        if "الطابق" in name:
            ordinal = next((o for o in _NUM_FLOORS_ORDINALS if o in name), None)
            if ordinal is not None:
                # Normalize الأول / الاول to a single key.
                key = ordinal.replace("الأول", "الاول")
                categories.add("ord:" + key)
                continue
        # Step 2c: repetition label standing in for N numbered upper floors.
        if "مكرر" in name and "الطوابق" in name:
            qty_raw = f.get("qty")
            try:
                qty = int(qty_raw) if qty_raw is not None else 1
            except (TypeError, ValueError):
                qty = 1
            for _ in range(max(1, qty)):
                categories.add(f"repeat:{repeat_idx}")
                repeat_idx += 1
            continue
    return len(categories) if categories else None


def _compute_floor_area_sum(floors: list[dict[str, Any]]) -> float | None:
    """Sum the printed areas of REAL floors only (ground + numbered upper +
    repeated upper), using the same reject list as _compute_num_floors.

    Unlike the count, this does NOT dedup A/B plan sheets — if a ground floor
    is split across "... القائم A" and "... القائم B", both subtotals add to
    the total floor area (they represent different physical halves).

      1. Reject by _NUM_FLOORS_REJECT keywords.
      2. Accept entries classified as ground / numbered-upper / repetition.
      3. Area per entry = printed_subtotal if present, else fallback to
         sum of rows' signed total_printed (respects + / − signs).
      4. Repetition entries ("مكرر الطوابق" with qty N) multiply their
         area by N, because printed_subtotal represents one typical floor.
      5. Return the total as a float, or None if no real floors were
         found / no subtotals available.
    """
    if not floors:
        return None
    total = 0.0
    any_added = False
    for f in floors:
        if not isinstance(f, dict):
            continue
        name = (f.get("name") or "").strip()
        if not name:
            continue
        # Step 1: reject.
        if any(kw in name for kw in _NUM_FLOORS_REJECT):
            continue
        # Step 2: must be a real floor (ground / numbered / repetition).
        is_ground = any(g in name for g in _NUM_FLOORS_GROUND)
        is_upper = ("الطابق" in name) and any(
            o in name for o in _NUM_FLOORS_ORDINALS
        )
        is_repeat = "مكرر" in name and "الطوابق" in name
        if not (is_ground or is_upper or is_repeat):
            continue
        # Step 3: area — prefer printed_subtotal, fall back to signed row sum.
        area = _as_float(f.get("printed_subtotal"))
        if area is None:
            row_sum = 0.0
            any_row = False
            for r in f.get("rows") or []:
                if not isinstance(r, dict):
                    continue
                tp = _as_float(r.get("total_printed"))
                if tp is None:
                    continue
                row_sum += _sign_factor(r.get("sign") or "+") * tp
                any_row = True
            area = row_sum if any_row else None
        if area is None:
            continue
        # Step 4: repetition multiplier (printed_subtotal is per-floor).
        if is_repeat:
            area *= max(1, _parse_qty(f.get("qty")))
        total += area
        any_added = True
    return total if any_added else None


async def analyze_floor_plan(job: Job, pdf_bytes: bytes, cfg: dict) -> None:
    """Run Claude on the floor-plan PDF, do the per-row math in Python, emit
    floor_start then exactly one of floor_done / floor_error. Never raises.
    """
    agent_cfg = cfg.get("agent", {})
    api_key_env = agent_cfg.get("api_key_env", "ANTHROPIC_API_KEY")
    api_key = os.environ.get(api_key_env)
    model = agent_cfg.get("model", "claude-opus-4-7")

    floor_cfg = cfg.get("floor", {}) or {}
    verify_enabled = bool(floor_cfg.get("verify", True))

    if not api_key:
        job.floor_result = {"error": f"{api_key_env} env var is not set"}
        await job.emit("floor_error", message=job.floor_result["error"])
        return

    await job.emit("floor_start", model=model, bytes=len(pdf_bytes))

    t0 = time.perf_counter()
    _log(f"[floor] -> Claude call #1 starting ({len(pdf_bytes):,} bytes, model={model})")

    try:
        client = anthropic.AsyncAnthropic(api_key=api_key, timeout=300.0, max_retries=3)
        pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")

        raw1, err1 = await _claude_extract(client, model, pdf_b64, focus_floors=None)
        if err1:
            _log(f"[floor] FAIL (pass 1): {err1}")
            job.floor_result = {"error": err1, "floors": []}
            await job.emit("floor_error", message=err1)
            return

        data = _postprocess(raw1)

        # Verification pass — re-read only the floors that had at least one
        # flagged row. Focused prompt; cheaper than re-reading the whole PDF.
        verified_names: list[str] = []
        if verify_enabled:
            bad = [f for f in data.get("floors", []) if f.get("has_row_mismatch")]
            if bad:
                names = [f.get("name") for f in bad if f.get("name")]
                _log(f"[floor] -> Claude call #2 (verification) on {len(names)} floor(s)")
                raw2, err2 = await _claude_extract(
                    client, model, pdf_b64, focus_floors=names
                )
                if err2:
                    _log(f"[floor]    verification skipped: {err2}")
                else:
                    data = _merge_verification(data, _postprocess(raw2))
                    verified_names = names

        data["verified_floor_names"] = verified_names
        dt = time.perf_counter() - t0
        n_bad = sum(
            1 for f in data.get("floors", []) for r in f.get("rows", [])
            if r.get("row_mismatch")
        )
        _log(
            f"[floor] <- done in {dt:.1f}s  "
            f"floors={len(data.get('floors', []))}  "
            f"mismatched_rows={n_bad}"
        )

        job.floor_result = data
        await job.emit("floor_done", **data)

    except Exception as e:
        dt = time.perf_counter() - t0
        _log(f"[floor] FAIL after {dt:.1f}s: {type(e).__name__}: {e}")
        traceback.print_exc()
        job.floor_result = {"error": f"{type(e).__name__}: {e}"}
        await job.emit("floor_error", message=str(e))


async def _claude_extract(
    client: "anthropic.AsyncAnthropic",
    model: str,
    pdf_b64: str,
    focus_floors: list[str] | None,
) -> tuple[dict[str, Any], str | None]:
    """Run one Claude pass over the PDF and return (raw_json, error_or_None)."""
    if focus_floors:
        focus_list = "\n".join(f"  • {n}" for n in focus_floors)
        user_text = (
            "VERIFICATION PASS — please re-read ONLY the following floor(s) "
            "and return their rows exactly as before (same schema), carefully "
            "re-examining every digit of dims and total_printed:\n"
            f"{focus_list}\n\n"
            "Return a JSON object with just {\"floors\": [...]} for those "
            "floors (no summary table, no licensed_total). Use the same row "
            "schema (dims, sign, total_printed, qty, no, page). If on "
            "re-reading you now see a different digit than before, emit the "
            "new value — do NOT force consistency with an earlier reading. "
            "Return ONLY valid JSON."
        )
        max_tokens = 16384
    else:
        user_text = (
            "Extract every row of every floor's breakdown, the printed "
            "subtotal of each floor, the printed grand total, and the "
            "licensed total, per the system instructions. Return ONLY valid "
            "JSON."
        )
        max_tokens = 32768

    t0 = time.perf_counter()
    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=FLOOR_SYSTEM_PROMPT,
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
                    {"type": "text", "text": user_text},
                ],
            }
        ],
    )
    dt = time.perf_counter() - t0

    text = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text += block.text

    stop_reason = getattr(response, "stop_reason", None)
    _log(
        f"[floor]    Claude returned {len(text)} chars in {dt:.1f}s "
        f"(stop_reason={stop_reason}, focus={len(focus_floors) if focus_floors else 0})"
    )
    if text:
        preview_head = text[:300].replace("\n", " ")
        _log(f"[floor]    head: {preview_head!r}")

    if stop_reason == "max_tokens":
        return {}, (
            f"Claude response hit the {max_tokens}-token output cap and was "
            "truncated — some floors/rows are missing."
        )

    raw = _parse_json(text)
    if raw.get("parse_error"):
        preview = (raw.get("raw") or "")[:200].replace("\n", " ")
        return {}, f"Claude response was not valid JSON. Preview: {preview!r}"

    floors_in = raw.get("floors") if isinstance(raw.get("floors"), list) else None
    if not floors_in and not focus_floors:
        preview = (text or "")[:300].replace("\n", " ")
        return {}, (
            "Claude returned a valid JSON with no floors — this usually means "
            "the prompt confused it or it failed to find tables. "
            f"Raw preview: {preview!r}"
        )

    return raw, None


def _parse_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from Claude's response text."""
    s = text.strip()
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
    return {"floors": [], "parse_error": True, "raw": text or "(empty response)"}


# ---------------------------------------------------------------------------
# Dim parsing — Python recomputes dim × qty from the dims string.
#
# Supported grammars (after Arabic→Western digit normalisation and replacing
# any Arabic multiplier with "×"):
#   1. Trapezoid:                "a + b × c × d"       → (a + b) × c × d
#      (common engineering shorthand where d is usually 0.5 for half-height)
#   2. Alt-trapezoid:            "(a + b) / 2 × c"     → ((a+b)/2) × c
#   3. Chained multiplication:   "a × b [× c × …]"     → product of all terms
#      (covers rectangles, triangles written as "a × b × 0.5", etc.)
#   4. Sum of rectangles:        "a × b + c × d [+ …]" → Σ of each a×b term
# ---------------------------------------------------------------------------

_BY_AUTOCAD_RE = re.compile(r"by\s*(autocad|cad)", re.IGNORECASE)

_NUM = r"[0-9]+(?:\.[0-9]+)?"
_DIM_TRAPEZOID_RE = re.compile(
    rf"^\s*({_NUM})\s*\+\s*({_NUM})\s*[xX×*]\s*({_NUM})\s*[xX×*]\s*({_NUM})\s*$"
)
_DIM_ALT_TRAPEZOID_RE = re.compile(
    rf"^\s*\(\s*({_NUM})\s*\+\s*({_NUM})\s*\)\s*/\s*2\s*[xX×*]\s*({_NUM})\s*$"
)
_DIM_CHAIN_RE = re.compile(rf"^\s*{_NUM}(?:\s*[xX×*]\s*{_NUM})+\s*$")
_DIM_SPLIT_RE = re.compile(r"\s*[xX×*]\s*")
_DIM_SUM_SPLIT_RE = re.compile(r"\s*\+\s*")


def _sign_factor(sign: Any) -> int:
    if isinstance(sign, str) and sign.strip() in {"-", "−", "–"}:
        return -1
    return 1


_ARABIC_DIGIT_MAP = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


def _normalize_digits(s: str) -> str:
    s = s.translate(_ARABIC_DIGIT_MAP)
    s = s.replace("\u066B", ".").replace("\u066C", ",")
    return s


def _parse_qty(v: Any) -> int:
    if v is None:
        return 1
    if isinstance(v, bool):
        return 1
    if isinstance(v, (int, float)):
        q = int(round(v))
        return q if q >= 1 else 1
    if isinstance(v, str):
        s = _normalize_digits(v).strip()
        if not s:
            return 1
        try:
            q = int(round(float(s)))
            return q if q >= 1 else 1
        except ValueError:
            return 1
    return 1


def _compute_per_unit_from_dims(dims: Any) -> float | None:
    """Parse a dims string and return its per-unit area in m², or None for
    "By CAD" / unparseable strings."""
    if dims is None:
        return None
    s = _normalize_digits(str(dims)).strip()
    if not s or _BY_AUTOCAD_RE.search(s):
        return None

    # Trapezoid "a + b × c × d" must win over sum-of-rectangles (both use "+").
    m = _DIM_TRAPEZOID_RE.match(s)
    if m:
        a, b, h, k = (float(m.group(i)) for i in range(1, 5))
        return (a + b) * h * k

    m = _DIM_ALT_TRAPEZOID_RE.match(s)
    if m:
        a, b, c = (float(m.group(i)) for i in range(1, 4))
        return ((a + b) / 2.0) * c

    if _DIM_CHAIN_RE.match(s):
        try:
            product = 1.0
            for term in _DIM_SPLIT_RE.split(s.strip()):
                product *= float(term)
            return product
        except ValueError:
            return None

    if "+" in s:
        parts = _DIM_SUM_SPLIT_RE.split(s.strip())
        if len(parts) >= 2:
            total = 0.0
            for part in parts:
                p = part.strip()
                if not _DIM_CHAIN_RE.match(p):
                    return None
                try:
                    prod = 1.0
                    for term in _DIM_SPLIT_RE.split(p):
                        prod *= float(term)
                    total += prod
                except ValueError:
                    return None
            return total

    return None


def _as_float(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = _normalize_digits(v).strip().replace(",", "")
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _postprocess(raw: dict[str, Any]) -> dict[str, Any]:
    """Per-row check only. For each row where the dims are parseable, compute
    `factor × (per_unit_from_dims × qty)` and compare to `factor × total_printed`.
    Flag the row if |Δ| > ROW_TOLERANCE_M2. Subtotals and the building grand
    total are extracted for display and not checked.
    """
    floors_in = raw.get("floors") if isinstance(raw.get("floors"), list) else []
    floors_out: list[dict[str, Any]] = []
    any_row_mismatch = False

    for floor in floors_in:
        if not isinstance(floor, dict):
            continue
        rows_in = floor.get("rows") if isinstance(floor.get("rows"), list) else []
        rows_out: list[dict[str, Any]] = []
        floor_has_mismatch = False

        for row in rows_in:
            if not isinstance(row, dict):
                continue
            dims_str = row.get("dims")
            sign = row.get("sign") or "+"
            factor = _sign_factor(sign)
            qty = _parse_qty(row.get("qty"))

            # Support both legacy "area" and new "total_printed" in the input.
            total_printed = _as_float(row.get("total_printed"))
            if total_printed is None:
                total_printed = _as_float(row.get("area"))

            by_autocad = bool(_BY_AUTOCAD_RE.search(str(dims_str or "")))
            per_unit = _compute_per_unit_from_dims(dims_str)
            parseable = per_unit is not None

            # Python's signed row value = factor × dim × qty.
            if parseable:
                dim_times_qty_signed = factor * per_unit * qty
            else:
                dim_times_qty_signed = None

            # Engineer's signed row value = factor × total_printed.
            printed_signed = (
                factor * total_printed if total_printed is not None else None
            )

            row_mismatch = (
                parseable
                and printed_signed is not None
                and abs(dim_times_qty_signed - printed_signed) > ROW_TOLERANCE_M2
            )
            if row_mismatch:
                floor_has_mismatch = True
                any_row_mismatch = True

            rows_out.append({
                "no": row.get("no"),
                "dims": dims_str,
                "sign": "+" if factor == 1 else "-",
                "qty": qty,
                "total_printed": total_printed,
                # Signed value computed from dims. null for "By CAD" rows.
                "dim_times_qty": (
                    round(dim_times_qty_signed, 4)
                    if dim_times_qty_signed is not None else None
                ),
                "row_mismatch": row_mismatch,
                "by_autocad": by_autocad,
                "parseable": parseable,
                # Legacy aliases kept for older consumers.
                "printed_area": total_printed,
                "computed": (
                    round(dim_times_qty_signed, 4)
                    if dim_times_qty_signed is not None
                    else (round(printed_signed, 4) if printed_signed is not None else None)
                ),
            })

        floor_qty = _parse_qty(floor.get("qty"))
        page = floor.get("page") if isinstance(floor.get("page"), int) else None
        printed_subtotal = _as_float(floor.get("printed_subtotal"))

        floors_out.append({
            "name": floor.get("name") or "",
            "qty": floor_qty,
            "page": page,
            "rows": rows_out,
            "printed_subtotal": printed_subtotal,
            "has_row_mismatch": floor_has_mismatch,
        })

    printed_grand = _as_float(raw.get("printed_grand_total"))
    licensed_total = _as_float(raw.get("licensed_total"))
    # Deterministic num-floors computation from the already-extracted `floors`
    # array. We tried asking Claude to return `num_floors` directly, but the
    # model was unreliable on compound names like "الطابق التسوية الثانية"
    # (basement whose name happens to contain an ordinal word) — it would
    # pattern-match on الثانية and count it as a numbered upper floor. The
    # Python pass applies a strict reject-first rule and only counts
    # "الطابق ال<ordinal>" survivors.
    num_floors = _compute_num_floors(floors_out)

    # Filtered floor-area sum (ground + numbered upper + repeated upper only).
    # Drives the نسبة التغطية الطابقية tile's ratio — excludes basements,
    # stairs, mechanical rooms, sub-plans, etc., which are all part of the raw
    # printed_grand_total but aren't "floors" for coverage purposes.
    floor_area_sum = _compute_floor_area_sum(floors_out)

    return {
        "version": 4,
        "floors": floors_out,
        # Display-only building-level values from the PDF's summary table.
        "printed_grand_total": printed_grand,
        "licensed_total": licensed_total,
        "num_floors": num_floors,
        "floor_area_sum": floor_area_sum,
        # Row-level mismatch summary across the whole building.
        "any_row_mismatch": any_row_mismatch,
    }


def _merge_verification(primary: dict[str, Any], verify: dict[str, Any]) -> dict[str, Any]:
    """Replace flagged rows in `primary` with their re-read counterparts from
    `verify` when the re-read changes the dims or the printed total. Adds
    per-row 'verification' ∈ {agreed, changed, not_verified}.
    """
    v2_by_name: dict[str, dict[str, Any]] = {}
    for f in verify.get("floors") or []:
        name = f.get("name")
        if name:
            v2_by_name[name] = f

    merged_floors: list[dict[str, Any]] = []
    any_rm_building = False
    for f1 in primary.get("floors") or []:
        name = f1.get("name")
        f2 = v2_by_name.get(name) if name else None
        if f2 is None:
            for r in f1.get("rows") or []:
                r.setdefault("verification", "not_verified")
            merged_floors.append(f1)
            if f1.get("has_row_mismatch"):
                any_rm_building = True
            continue

        rows1 = f1.get("rows") or []
        rows2 = f2.get("rows") or []

        def _row_key(row: dict[str, Any], idx: int) -> Any:
            no = row.get("no")
            return no if no is not None else f"__idx{idx}"

        r2_by_key = {_row_key(r, i): r for i, r in enumerate(rows2)}

        merged_rows: list[dict[str, Any]] = []
        for i, r1 in enumerate(rows1):
            r2 = r2_by_key.get(_row_key(r1, i))
            if r2 is None:
                r1.setdefault("verification", "not_verified")
                merged_rows.append(r1)
                continue
            same_dims = (r1.get("dims") or "") == (r2.get("dims") or "")
            same_total = _close_enough(
                r1.get("total_printed"), r2.get("total_printed"), ROW_TOLERANCE_M2
            )
            if same_dims and same_total:
                r1["verification"] = "agreed"
                merged_rows.append(r1)
            else:
                # v2 differs — if it resolves the mismatch (row ok after
                # re-read), prefer v2; otherwise keep v1 but mark as "changed"
                # so the UI highlights the conflict.
                prefer_v2 = not r2.get("row_mismatch")
                if prefer_v2:
                    r2["verification"] = "changed"
                    merged_rows.append(r2)
                else:
                    r1["verification"] = "agreed"
                    merged_rows.append(r1)

        floor_has_mm = any(r.get("row_mismatch") for r in merged_rows)
        if floor_has_mm:
            any_rm_building = True

        f1_out = dict(f1)
        f1_out["rows"] = merged_rows
        f1_out["has_row_mismatch"] = floor_has_mm
        f1_out["verified"] = True
        merged_floors.append(f1_out)

    out = dict(primary)
    out["floors"] = merged_floors
    out["any_row_mismatch"] = any_rm_building
    return out


def _close_enough(a: Any, b: Any, tol: float) -> bool:
    fa = _as_float(a)
    fb = _as_float(b)
    if fa is None or fb is None:
        return False
    return abs(fa - fb) <= tol
