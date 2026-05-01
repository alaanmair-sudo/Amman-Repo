"""AI-powered PDF summarizer. Completely isolated from the CAD pipeline.

Targets Jordanian land-record PDFs in Arabic (plot number, basin name/number,
village name, etc.) and produces a structured JSON summary. Reads the PDF via
the model's native document input — no third-party PDF parser needed.

Runs as its own asyncio task parallel to `run_agent`. Emits `pdf_start` /
`pdf_done` / `pdf_error` events over the same SSE stream as the CAD pipeline
but never touches the CAD pipeline's state.
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


def _log(msg: str) -> None:
    """Console log that survives Windows cp1252 consoles — never raises.

    Using bare `print()` with non-ASCII characters crashes on default Windows
    consoles (charmap codec). Since this log is called from an asyncio task,
    an unhandled UnicodeEncodeError here silently kills the whole pipeline
    task. This helper encodes via the stream's own error handler and falls
    back to a swallow-on-failure if even that fails.
    """
    try:
        sys.stdout.write(msg + "\n")
        sys.stdout.flush()
    except Exception:
        try:
            sys.stdout.write(msg.encode("ascii", errors="replace").decode("ascii") + "\n")
            sys.stdout.flush()
        except Exception:
            pass

from app.jobs import Job


PDF_SYSTEM_PROMPT = """You are analyzing an Arabic PDF related to a land/building permit application. The document may be a land-registration certificate (سند تسجيل), a title-block / project-information sheet from an architectural drawing, a previous licensing certificate, a surveyor's report, or any similar supporting document. Extract every identifying field you can read and produce a short summary.

Look specifically for these fields (Arabic → English mapping). Any that are
not visible in THIS document should be returned as null — do NOT invent or
borrow from typical documents.

Land-parcel identity (usually present on land records AND on drawing title
blocks):
- رقم قطعة الأرض / رقم القطعة   → plot_number
- اسم الحوض                       → basin_name
- رقم الحوض                       → basin_number
- اسم القرية                      → village_name
- المنطقة / الحي                   → neighborhood
- Total area (المساحة / مساحة القطعة) — see AREA RULES below.

Building / project (typically present on drawing title blocks, addition
applications, licensing certificates):
- اسم المشروع                     → project_name
- المالك / السادة                 → owner
- نوع البناء (قائم / مستحدث …)    → building_type
- منطقة التنظيم                   → zoning_region  (e.g. "سكن أخضر",
                                    "سكن ب", "تجاري", etc.)
- المهندس / اسم المهندس           → engineer  (include firm + name when both
                                    appear, e.g. "المهندس اكرم عطية — ARCH-JEA")
- رقم التسجيل / رقم الترخيص       → registration_number  (the doc-level
                                    number; distinct from plot_number)
- Any printed date on the page    → document_date  (ISO-like string, keep the
                                    format Claude sees if uncertain)
- رقم البناية                      → building_number  (a building-level ID
                                    distinct from plot_number — appears on
                                    occupancy permits, building licenses,
                                    title-block fields. ONLY accept a value
                                    explicitly labelled "رقم البناية" — do
                                    NOT confuse with "رقم الطابق" (floor
                                    number) or "رقم الشقة" (apartment
                                    number); those are different fields and
                                    must go in other_fields, not here.
                                    null if the deed has no building number.)
- اسم الشارع / الشارع              → street_name      (the street the lot
                                    fronts onto — appears on regulatory
                                    site plans and some deeds. May be null.)

Ownership / administrative (usually only on land records):
- المالك (as listed owner)        → already captured above as owner
- مديرية (directorate), لواء (district), محافظة (governorate), and similar
  jurisdiction labels → put into other_fields.

════════════════════════════════════════════════════
AREA RULES — read carefully, this is the most common source of errors.
════════════════════════════════════════════════════

On Jordanian / Arabic land titles, the area is written as TWO COMPONENTS that
MUST BE SUMMED:

  • "دونم"     (dunum) — a unit equal to 1000 m². The printed integer (e.g. "4
                          دونم") contributes 4 × 1000 = 4000 m² to the total.
  • "متر مربع" (m²)   — the remainder in square metres, strictly < 1000.

Example: "4 دونم 877.170 متر مربع"  ==  4 × 1000 + 877.170  ==  4877.170 m².

Extract the two components SEPARATELY as numeric JSON fields, plus the raw
string exactly as printed:

  • "area_dunum"        — integer number of dunums (from "X دونم"). Omit or
                          use null if no "دونم" appears.
  • "area_m2_remainder" — the "متر مربع" remainder as a positive number,
                          strictly < 1000 when paired with a dunum count.
                          If the document shows ONLY a plain m² value (no
                          "دونم"), put that value here and leave
                          area_dunum null.
  • "area"              — the raw Arabic string exactly as printed (for
                          reference only). null if absent.

Do NOT attempt to sum the two components yourself — the downstream code will
compute `area_dunum × 1000 + area_m2_remainder`. Do NOT guess or invent a
number; if you can only see one of the two components, return the one you see
and leave the other null.

════════════════════════════════════════════════════
OUTPUT
════════════════════════════════════════════════════

Return ONLY a valid JSON object (no surrounding text, no markdown fence):

{
  "plot_number": "...",
  "basin_name": "...",
  "basin_number": "...",
  "village_name": "...",
  "neighborhood": "...",
  "project_name": "...",
  "owner": "...",
  "building_type": "...",
  "zoning_region": "...",
  "engineer": "...",
  "registration_number": "...",
  "document_date": "...",
  "building_number": "...",
  "street_name": "...",
  "area": "4 دونم 877.170 متر مربع",
  "area_dunum": 4,
  "area_m2_remainder": 877.170,
  "other_fields": [
    {"label": "<field label, English or Arabic as appears>", "value": "<value>"}
  ],
  "summary": "<2-3 sentence plain-English summary>"
}

Rules:
- If a field is not present in the document, set its value to null (JSON null, not the string "null").
- Preserve Arabic text verbatim for names/labels — do NOT transliterate.
- Put anything interesting that doesn't map to one of the structured fields above into other_fields — dates, stamp numbers, contract-office names, syndicate IDs, signatures, etc. Do NOT put the area components there — they belong in the structured top-level fields.
- summary must be in English, 2-3 sentences, factual.
"""


async def _extract_one_pdf(
    client: "anthropic.AsyncAnthropic",
    model: str,
    pdf_bytes: bytes,
    log_tag: str,
) -> dict[str, Any]:
    """Run Claude on one PDF and return the parsed + area-enriched data dict.

    Shared by the primary deed path and the additional-PDF path — there is no
    behavioural difference between them, only the event names and the job-
    level slot we write the result into.
    """
    t0 = time.perf_counter()
    _log(f"{log_tag} -> Claude call starting ({len(pdf_bytes):,} bytes, model={model})")

    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")
    response = await client.messages.create(
        model=model,
        max_tokens=2048,
        system=PDF_SYSTEM_PROMPT,
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
                            "Analyze this PDF and extract every identifying "
                            "field per your system instructions. Return ONLY "
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
    _log(f"{log_tag} <- Claude returned {len(text)} chars in {dt:.1f}s")

    data = _parse_json(text)
    data.setdefault("summary", "(no summary returned)")
    # Attach a numeric area_m2 derived from the structured fields Claude
    # returned (area_dunum × 1000 + area_m2_remainder), with graceful
    # fallbacks for older prompt versions or stale payloads.
    data["area_m2"] = _extract_area_m2(data)
    return data


async def analyze_pdf(job: Job, pdf_bytes: bytes, cfg: dict) -> None:
    """Primary deed pipeline. Emits pdf_start → pdf_done / pdf_error. Never
    raises — any exception becomes a pdf_error event."""
    agent_cfg = cfg.get("agent", {})
    api_key_env = agent_cfg.get("api_key_env", "ANTHROPIC_API_KEY")
    api_key = os.environ.get(api_key_env)
    model = agent_cfg.get("model", "claude-opus-4-7")

    if not api_key:
        job.pdf_result = {"error": f"{api_key_env} env var is not set"}
        await job.emit("pdf_error", message=job.pdf_result["error"])
        return

    await job.emit("pdf_start", model=model, bytes=len(pdf_bytes))

    try:
        # Separate AsyncAnthropic instance -> separate httpx connection pool ->
        # fully independent HTTP request from the floor-plan and CAD pipelines.
        client = anthropic.AsyncAnthropic(api_key=api_key, timeout=90.0, max_retries=1)
        data = await _extract_one_pdf(client, model, pdf_bytes, log_tag="[deed]")
        job.pdf_result = data
        await job.emit("pdf_done", **data)

    except Exception as e:
        _log(f"[deed] FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
        job.pdf_result = {"error": f"{type(e).__name__}: {e}"}
        await job.emit("pdf_error", message=str(e))


async def analyze_extra_pdf(
    job: Job,
    pdf_bytes: bytes,
    cfg: dict,
    index: int,
    filename: str,
) -> None:
    """Additional-PDF pipeline. One task per uploaded file. Writes into
    job.extras_results[index] and emits extra_start → extra_done / extra_error
    with {index, filename} so the frontend can render a card per file.
    """
    agent_cfg = cfg.get("agent", {})
    api_key_env = agent_cfg.get("api_key_env", "ANTHROPIC_API_KEY")
    api_key = os.environ.get(api_key_env)
    model = agent_cfg.get("model", "claude-opus-4-7")

    # The slot is pre-allocated by main.py at intake, but defend against a
    # resized list just in case.
    while len(job.extras_results) <= index:
        job.extras_results.append({"filename": filename, "status": "pending"})
    slot = job.extras_results[index]
    slot.setdefault("filename", filename)

    if not api_key:
        msg = f"{api_key_env} env var is not set"
        slot.update({"status": "error", "error": msg})
        await job.emit("extra_error", index=index, filename=filename, message=msg)
        return

    await job.emit(
        "extra_start",
        index=index,
        filename=filename,
        model=model,
        bytes=len(pdf_bytes),
    )

    tag = f"[extra#{index}]"
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key, timeout=90.0, max_retries=1)
        data = await _extract_one_pdf(client, model, pdf_bytes, log_tag=tag)
        slot.update({"status": "done", "result": data, "error": None})
        await job.emit("extra_done", index=index, filename=filename, **data)

    except Exception as e:
        _log(f"{tag} FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
        msg = f"{type(e).__name__}: {e}"
        slot.update({"status": "error", "error": msg, "result": None})
        await job.emit("extra_error", index=index, filename=filename, message=msg)


# Arabic-Indic digits → ASCII digits (for "١٠٥٦" → "1056"). Covers both the
# standard Arabic-Indic block (U+0660..U+0669) and the Eastern Arabic-Indic
# block (U+06F0..U+06F9) used in Persian/Urdu just in case.
_ARABIC_DIGITS_MAP = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


def _coerce_float(v: Any) -> float | None:
    """Coerce a JSON value to float; handle Arabic-Indic digits and '٫' decimal."""
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


# Parses an area string like "4 دونم 877.170 متر مربع" into (dunum, m²_remainder).
# Arabic-Indic digits and "٫"/"٬" are normalised first. Returns (None, None) if
# neither component is found.
_DUNUM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:دونم|dunum|dunam)", re.IGNORECASE)
_M2_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:متر\s*مربع|م²|m²|m2|sq\s*m)", re.IGNORECASE)


def _parse_area_string(s: str) -> tuple[float | None, float | None]:
    """Extract (dunum, m²_remainder) from a raw Arabic area string. If the
    string has only a plain m² number with no "دونم", returns (None, m²)."""
    if not s:
        return (None, None)
    norm = s.translate(_ARABIC_DIGITS_MAP)
    norm = norm.replace("\u066B", ".").replace("\u066C", ",").replace(",", "")

    dunum: float | None = None
    rem: float | None = None

    m = _DUNUM_RE.search(norm)
    if m:
        try:
            dunum = float(m.group(1))
        except ValueError:
            pass

    m = _M2_RE.search(norm)
    if m:
        try:
            rem = float(m.group(1))
        except ValueError:
            pass

    # If no unit was found at all, fall back to the first number as a plain m²
    # value. This is the "only a single total m² number appears" case from the
    # prompt.
    if dunum is None and rem is None:
        m = re.search(r"(\d+(?:\.\d+)?)", norm)
        if m:
            try:
                rem = float(m.group(1))
            except ValueError:
                pass

    return (dunum, rem)


def _extract_area_m2(data: dict[str, Any]) -> float | None:
    """Compute the deed's area in m² from the structured fields Claude returns
    (`area_dunum` + `area_m2_remainder`), falling back to parsing the raw
    `area` string for older Claude outputs that didn't split the components.

    Rule: total_m² = dunum × 1000 + remainder_m².
    Returns None if neither component is available.
    """
    dunum = _coerce_float(data.get("area_dunum"))
    rem = _coerce_float(data.get("area_m2_remainder"))

    # Fallback 1: parse the raw `area` string (e.g. from an old prompt version
    # or a response where Claude only emitted the raw string).
    if dunum is None and rem is None:
        d2, r2 = _parse_area_string(str(data.get("area") or ""))
        dunum = dunum if dunum is not None else d2
        rem = rem if rem is not None else r2

    # Fallback 2: older saved data or an off-spec response might have the
    # area buried in other_fields.
    if dunum is None and rem is None:
        others = data.get("other_fields")
        if isinstance(others, list):
            for f in others:
                if not isinstance(f, dict):
                    continue
                label = str(f.get("label") or "")
                if "مساحة" in label or "area" in label.lower():
                    d2, r2 = _parse_area_string(str(f.get("value") or ""))
                    dunum = dunum if dunum is not None else d2
                    rem = rem if rem is not None else r2
                    if dunum is not None or rem is not None:
                        break

    if dunum is None and rem is None:
        return None

    total = 0.0
    if dunum is not None:
        total += dunum * 1000.0
    if rem is not None:
        total += rem
    return total


def _parse_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from Claude's response text."""
    s = text.strip()
    # Strip possible markdown fence
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```\s*$", "", s)
    # Find the first balanced { ... } block
    m = re.search(r"\{[\s\S]*\}", s)
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {"summary": text or "(empty response)", "parse_error": True}
