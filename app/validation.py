"""Upload-time + pipeline error validation.

This module centralizes:
  - The per-role layer allowlist (case-insensitive) for CAD drawings
  - All Arabic error strings shown to the user
  - English → Arabic translation for pipeline errors that bubble up through
    SSE (geometry.py, etc.)

Arabic wording is owned here so there's a single place to edit copy.
"""

from __future__ import annotations


# ─── Layer allowlist ──────────────────────────────────────────────────────
# Each role is satisfied when a layer name matches ANY of these aliases after
# casefolding. The defaults below are the fallback if config.yaml is missing
# or doesn't list a role. config.yaml's `layers.<role>` entries are *unioned*
# with these defaults — both string and list values are accepted, e.g.:
#   layers:
#     building: BUILDING            # single name, treated as one alias
#     lot: [LOT, LOT_BOUNDARY]      # list of aliases
# Added entries take effect on next process start (cache cleared at import).

_DEFAULT_LAYERS: dict[str, frozenset[str]] = {
    "building": frozenset({"building", "bldg"}),
    "lot": frozenset({"lot", "lot_boundary"}),
    "street": frozenset({"street", "road"}),
}

_layer_cache: dict[str, frozenset[str]] | None = None


def _resolve_layer_synonyms() -> dict[str, frozenset[str]]:
    """Resolve the effective per-role alias sets, layering config.yaml on
    top of the hardcoded defaults. Cached after first call. The result is
    casefolded so callers can compare against `(name or "").casefold()`.

    Reading config here keeps this module config-aware without forcing
    every caller to thread the cfg dict through. Failures (missing file,
    yaml import error) silently fall back to defaults.
    """
    global _layer_cache
    if _layer_cache is not None:
        return _layer_cache

    merged: dict[str, set[str]] = {role: set(aliases) for role, aliases in _DEFAULT_LAYERS.items()}
    try:
        from pathlib import Path
        import yaml  # type: ignore
        cfg_path = Path(__file__).resolve().parent.parent / "config.yaml"
        if cfg_path.is_file():
            cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
            layers_cfg = (cfg.get("layers") or {}) if isinstance(cfg, dict) else {}
            for role in ("building", "lot", "street"):
                raw = layers_cfg.get(role)
                if raw is None:
                    continue
                if isinstance(raw, str):
                    merged[role].add(raw.strip().casefold())
                elif isinstance(raw, list):
                    for item in raw:
                        if item:
                            merged[role].add(str(item).strip().casefold())
    except Exception:
        # Config drift shouldn't crash validation — fall back to defaults.
        pass

    _layer_cache = {role: frozenset(aliases) for role, aliases in merged.items()}
    return _layer_cache


def classify_layer(name: str) -> str | None:
    """Return 'building' | 'lot' | 'street' | None for the given layer name.
    Matching is case-insensitive and reads aliases from config.yaml unioned
    with the module defaults."""
    n = (name or "").strip().casefold()
    if not n:
        return None
    aliases = _resolve_layer_synonyms()
    if n in aliases["building"]:
        return "building"
    if n in aliases["lot"]:
        return "lot"
    if n in aliases["street"]:
        return "street"
    return None


def find_missing_roles(layer_names: list[str]) -> list[str]:
    """Required roles (in fixed display order) that no drawing layer matches."""
    found: set[str] = set()
    for name in layer_names or []:
        role = classify_layer(name)
        if role:
            found.add(role)
    return [r for r in ("building", "lot", "street") if r not in found]


# ─── Arabic error messages (upload-time, inline) ──────────────────────────

MSG_MISSING_CAD        = "ملف المخطط (CAD) مطلوب"
MSG_MISSING_DEED       = "ملف سند التسجيل مطلوب"
MSG_MISSING_FLOOR      = "ملف خطة مساحة الطابقية مطلوب"
MSG_MISSING_SITE_PLAN  = "ملف مخطط موقع تنظيمي مطلوب"

MSG_CAD_EXTENSION      = "صيغة الملف غير مدعومة — استخدم DWG أو DXF أو DWF"
MSG_NOT_PDF            = "يجب أن يكون ملف PDF"

MSG_CAD_NO_LAYERS      = "المخطط لا يحتوي على أي طبقات"
MSG_CAD_MISSING_BUILDING = "المخطط يفتقد إلى طبقة المبنى (BUILDING أو BLDG)"
MSG_CAD_MISSING_LOT      = "المخطط يفتقد إلى طبقة قطعة الأرض (LOT أو LOT_BOUNDARY)"
MSG_CAD_MISSING_STREET   = "المخطط يفتقد إلى طبقة الشارع (STREET أو ROAD)"

MSG_CAD_UNREADABLE     = "تعذّر فحص الطبقات — تأكّد من تشغيل AutoCAD"


_ROLE_TO_MSG = {
    "building": MSG_CAD_MISSING_BUILDING,
    "lot": MSG_CAD_MISSING_LOT,
    "street": MSG_CAD_MISSING_STREET,
}


def build_cad_layer_error(layer_names: list[str]) -> str | None:
    """One combined Arabic message for all CAD layer problems, or None if OK.

    Returns `MSG_CAD_NO_LAYERS` when the drawing has zero layers; otherwise a
    newline-joined list of the missing-role messages so the user sees every
    issue at once instead of fixing-then-rediscovering.
    """
    if not layer_names:
        return MSG_CAD_NO_LAYERS
    missing = find_missing_roles(layer_names)
    if not missing:
        return None
    return "\n".join(_ROLE_TO_MSG[r] for r in missing)


# ─── Pipeline error translation (SSE banner) ──────────────────────────────
# Called on the Python side right before emitting an `error` SSE event. Maps
# known English ValueError / RuntimeError messages from geometry.py and the
# tool executor onto human-readable Arabic. Unknown errors pass through
# unchanged so we never hide a useful stack trace.

MSG_PIPE_BLDG_EMPTY   = "لم يتم العثور على أي عناصر على طبقة المبنى — راجع الرسم"
MSG_PIPE_LOT_EMPTY    = "لم يتم العثور على أي عناصر على طبقة قطعة الأرض — راجع الرسم"
MSG_PIPE_BLDG_OPEN    = "حدود طبقة المبنى غير مغلقة — راجع الرسم"
MSG_PIPE_LOT_OPEN     = "حدود طبقة قطعة الأرض غير مغلقة — راجع الرسم"
MSG_PIPE_BLDG_OUTSIDE = "المبنى يتجاوز حدود قطعة الأرض — الرسم غير صالح"

MSG_PIPE_SITE_PLAN_WRONG     = "الملف المرفوع ليس مخطط موقع تنظيمي — تعذّر متابعة التحليل"
MSG_PIPE_SITE_PLAN_UNREAD    = "تعذّر قراءة الارتدادات من مخطط الموقع التنظيمي — تعذّر متابعة التحليل"


def _has_building_keyword(s: str) -> bool:
    return any(k in s for k in ("building", "bldg"))


def _has_lot_keyword(s: str) -> bool:
    # "parcel" is listed in case the label ever comes through as "parcel"
    return any(k in s for k in ("lot", "parcel"))


def translate_pipeline_error(english: str) -> str:
    """Map known English pipeline errors to Arabic. Pass-through for unknown."""
    s = (english or "")
    low = s.lower()

    if "no polylines found on" in low:
        if _has_building_keyword(low):
            return MSG_PIPE_BLDG_EMPTY
        if _has_lot_keyword(low):
            return MSG_PIPE_LOT_EMPTY

    if "do not form a closed boundary" in low:
        if _has_building_keyword(low):
            return MSG_PIPE_BLDG_OPEN
        if _has_lot_keyword(low):
            return MSG_PIPE_LOT_OPEN

    if "building polygon is not fully within the lot polygon" in low:
        return MSG_PIPE_BLDG_OUTSIDE

    return s


# ─── Missing-data rows (table shown to reviewer) ──────────────────────────
# Each row names a document (الوثيقة), the missing piece (البيانات الناقصة),
# and what the submitter must do (إجراء مطلوب). `key` stays internal so the
# frontend can dedupe when the same issue is detected by multiple stages.

DOC_CAD        = "مخطط CAD"
DOC_SITE_PLAN  = "مخطط موقع تنظيمي"


def _row(key: str, document: str, issue: str, action: str, *, blocking: bool = False) -> dict:
    """Build a missing-data row. `blocking=True` marks issues severe enough
    to halt the analysis pipeline and bounce the submitter back to upload
    BEFORE the heavy CAD agent runs (missing required layers, deed↔site-plan
    identity mismatches). Default rows are informational — they appear in
    the review panel but don't block analysis."""
    row = {"key": key, "document": document, "issue": issue, "action": action}
    if blocking:
        row["blocking"] = True
    return row


# Preflight: required CAD layers — ALL three (building, lot, street) are
# blocking. Without any of them the CAD agent has nothing to compute, so
# we halt the pipeline and send the submitter back to the upload screen.
MD_MISSING_BUILDING_LAYER = _row(
    "cad_missing_building_layer",
    DOC_CAD,
    "طبقة المبنى (BUILDING أو BLDG) غير موجودة",
    "أضف طبقة باسم BUILDING أو BLDG تحتوي على مضلع المبنى المغلق",
    blocking=True,
)
MD_MISSING_LOT_LAYER = _row(
    "cad_missing_lot_layer",
    DOC_CAD,
    "طبقة قطعة الأرض (LOT أو LOT_BOUNDARY) غير موجودة",
    "أضف طبقة باسم LOT أو LOT_BOUNDARY تحتوي على مضلع القطعة المغلق",
    blocking=True,
)
MD_MISSING_STREET_LAYER = _row(
    "cad_missing_street_layer",
    DOC_CAD,
    "طبقة الشارع (STREET أو ROAD) غير موجودة",
    "أضف طبقة باسم STREET أو ROAD على محور الشارع المحاذي للقطعة",
    blocking=True,
)

# Geometry: layer exists but is unusable
MD_BUILDING_EMPTY = _row(
    "cad_building_empty",
    DOC_CAD,
    "طبقة المبنى فارغة — لا توجد عناصر",
    "ارسم مضلع المبنى المغلق على طبقة BUILDING",
)
MD_LOT_EMPTY = _row(
    "cad_lot_empty",
    DOC_CAD,
    "طبقة قطعة الأرض فارغة — لا توجد عناصر",
    "ارسم مضلع القطعة المغلق على طبقة LOT",
)
MD_BUILDING_OPEN = _row(
    "cad_building_open",
    DOC_CAD,
    "حدود المبنى غير مغلقة",
    "أغلق مضلع المبنى بحيث تتصل نقطة النهاية بنقطة البداية",
)
MD_LOT_OPEN = _row(
    "cad_lot_open",
    DOC_CAD,
    "حدود قطعة الأرض غير مغلقة",
    "أغلق مضلع القطعة بحيث تتصل نقطة النهاية بنقطة البداية",
)
MD_BUILDING_OUTSIDE_LOT = _row(
    "cad_building_outside_lot",
    DOC_CAD,
    "المبنى يتجاوز حدود قطعة الأرض",
    "أعد رسم المبنى بحيث يكون بالكامل داخل حدود القطعة",
)

# Site plan
MD_SITE_PLAN_WRONG_DOC = _row(
    "site_plan_wrong_doc",
    DOC_SITE_PLAN,
    "الملف المرفوع ليس مخطط موقع تنظيمي",
    "ارفع مخطط موقع تنظيمي صادر عن الأمانة يحمل العنوان «مخطط موقع تنظيمي»",
)
MD_SITE_PLAN_UNREADABLE = _row(
    "site_plan_unreadable",
    DOC_SITE_PLAN,
    "قيم الارتدادات (امامي / جانبي) غير مقروءة",
    "استبدل بنسخة واضحة تظهر فيها قيم الارتدادات تحت عمود «الارتدادات (متر)»",
)


_ROLE_TO_MISSING_ROW = {
    "building": MD_MISSING_BUILDING_LAYER,
    "lot": MD_MISSING_LOT_LAYER,
    "street": MD_MISSING_STREET_LAYER,
}


def cad_layer_issues(layer_names: list[str]) -> list[dict]:
    """Return one missing-data row per required role that has no layer match.
    Empty list = all three required layers present."""
    return [_ROLE_TO_MISSING_ROW[r] for r in find_missing_roles(layer_names)]


# Compliance violations are built dynamically from the pipeline's numbers
# (actual vs. allowed). They live in the same review-panel table as missing
# documents so the reviewer can send the application back to the submitter
# with one consolidated list.

DOC_CAD_VS_SITE_PLAN = "مخطط CAD مقابل مخطط موقع تنظيمي"


def _fmt_pct(v: float | int) -> str:
    """Arabic-style percentage — one decimal, '٪' suffix (Arabic percent sign)."""
    return f"{float(v):.1f}٪"


def _fmt_area(v: float | int) -> str:
    return f"{float(v):.2f} م²"


def coverage_violation_row(actual_pct: float, allowed_pct: float) -> dict:
    """Build a missing-data row for over-coverage (building ÷ lot exceeds the
    allowed نسبة التغطية from the regulatory site plan)."""
    return _row(
        "coverage_exceeds_allowed",
        DOC_CAD_VS_SITE_PLAN,
        f"نسبة التغطية تتجاوز المسموح: {_fmt_pct(actual_pct)} "
        f"(المسموح {_fmt_pct(allowed_pct)})",
        f"قلّل مساحة المبنى بحيث لا تتجاوز نسبة التغطية {_fmt_pct(allowed_pct)} "
        "من مساحة القطعة",
    )


def setback_violation_row(
    violation_area_m2: float,
    fine_jd: float | None = None,
    is_serious: bool = False,
) -> dict:
    """Build a missing-data row for a setback breach. If `is_serious` the
    building has also crossed the lot boundary (a hard violation), so we
    reflect that in the issue text."""
    if is_serious:
        issue = (
            "المبنى يخالف الارتدادات المطلوبة ويتجاوز حدود القطعة — "
            f"مساحة المخالفة {_fmt_area(violation_area_m2)}"
        )
    else:
        issue = (
            "المبنى يخالف الارتدادات المطلوبة — "
            f"مساحة المخالفة {_fmt_area(violation_area_m2)}"
        )
    if fine_jd is not None and fine_jd > 0:
        issue += f" (غرامة تقديرية {float(fine_jd):.0f} د.أ)"
    return _row(
        "setback_violation",
        DOC_CAD_VS_SITE_PLAN,
        issue,
        "عدّل موقع أو شكل المبنى بحيث يلتزم بقيم الارتدادات المطلوبة في "
        "مخطط الموقع التنظيمي",
    )


def geometry_error_to_row(english: str) -> dict | None:
    """Classify a ValueError message from geometry.py into a missing-data row.
    Returns None if the message isn't a known content issue (caller falls
    back to the generic error banner for real system failures)."""
    s = (english or "")
    low = s.lower()
    if "no polylines found on" in low:
        if _has_building_keyword(low):
            return MD_BUILDING_EMPTY
        if _has_lot_keyword(low):
            return MD_LOT_EMPTY
    if "do not form a closed boundary" in low:
        if _has_building_keyword(low):
            return MD_BUILDING_OPEN
        if _has_lot_keyword(low):
            return MD_LOT_OPEN
    if "building polygon is not fully within the lot polygon" in low:
        return MD_BUILDING_OUTSIDE_LOT
    return None


# ─── Cross-document discrepancy checks ───────────────────────────────────
# Each pipeline (deed PDF, floor-plan PDF, site-plan PDF, CAD geometry) only
# sees its own input. The functions below cross-validate values that should
# agree across pipelines — deed lot area vs CAD lot area, deed identifiers
# vs site-plan identifiers, floor count vs the regulatory max, etc. They run
# in `Job._maybe_finalize` after every pipeline has committed its result, so
# every value is final before comparison. Each returns either a missing-data
# row (the discrepancy) or None (values agree, or one side is missing).

DOC_DEED_VS_CAD            = "السند مقابل مخطط CAD"
DOC_DEED_VS_SITE_PLAN      = "السند مقابل مخطط موقع تنظيمي"
DOC_FLOOR_VS_SITE_PLAN     = "خطة الطوابق مقابل مخطط موقع تنظيمي"
DOC_FLOOR_RATIO            = "نسبة التغطية الطابقية"

# Floor-coverage epsilon — same shape as the existing coverage_pct check
# (agent.py: 0.05) so we don't fire on floating-point noise.
FLOOR_RATIO_EPSILON_PCT = 0.05


def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _to_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None


def _norm_id(s) -> str:
    """Normalize an Arabic identifier string for equality comparison —
    strip, casefold, collapse internal whitespace. Empty for None/empty input."""
    if s is None:
        return ""
    return " ".join(str(s).split()).strip().casefold()


def _split_numbered_label(combined) -> tuple[str, str]:
    """Site-plan stores basin/village as '<number> <name>' (e.g. '8 مرج الاجرب').
    Split into (number_part, name_part). Either may be empty if the input
    doesn't fit the pattern. Pure-digit input → (digits, ""); pure-name
    input → ("", name)."""
    s = (str(combined) if combined is not None else "").strip()
    if not s:
        return "", ""
    parts = s.split(maxsplit=1)
    if len(parts) == 1:
        return (parts[0], "") if parts[0].isdigit() else ("", parts[0])
    head, tail = parts
    if head.isdigit():
        return head, tail.strip()
    # Number could be at the end instead — try the reverse split.
    rparts = s.rsplit(maxsplit=1)
    if len(rparts) == 2 and rparts[1].isdigit():
        return rparts[1], rparts[0].strip()
    return "", s


def cross_doc_lot_area_mismatch(pdf_result: dict, cad_result: dict) -> dict | None:
    """Deed area_m2 must equal the CAD lot polygon area exactly."""
    deed_area = _to_float((pdf_result or {}).get("area_m2"))
    cad_area = _to_float((cad_result or {}).get("lot_area"))
    if deed_area is None or cad_area is None or deed_area <= 0 or cad_area <= 0:
        return None
    diff = abs(deed_area - cad_area)
    if diff == 0:
        return None
    return _row(
        "deed_cad_lot_area_mismatch",
        DOC_DEED_VS_CAD,
        f"مساحة القطعة في السند {_fmt_area(deed_area)} لا تطابق المساحة المحسوبة "
        f"من المخطط {_fmt_area(cad_area)} (فرق {_fmt_area(diff)})",
        "تحقق من السند والمخطط — صحّح المستند الذي يحمل القيمة الخاطئة وأعد رفعه",
    )


def cross_doc_plot_mismatch(pdf_result: dict, site_plan_result: dict) -> dict | None:
    deed = _norm_id((pdf_result or {}).get("plot_number"))
    sp = _norm_id((site_plan_result or {}).get("plot_number"))
    if not deed or not sp or deed == sp:
        return None
    # Identity mismatch — the deed and site plan describe different lots.
    # Blocking: there's no point running setback/coverage analysis when we
    # can't be sure which property the documents represent.
    return _row(
        "deed_site_plan_plot_mismatch",
        DOC_DEED_VS_SITE_PLAN,
        f"رقم القطعة في السند ({pdf_result.get('plot_number')}) لا يطابق رقم القطعة "
        f"في مخطط الموقع التنظيمي ({site_plan_result.get('plot_number')})",
        "تأكد من أن السند ومخطط الموقع التنظيمي يخصّان نفس القطعة",
        blocking=True,
    )


def cross_doc_basin_mismatch(pdf_result: dict, site_plan_result: dict) -> dict | None:
    deed_num = _norm_id((pdf_result or {}).get("basin_number"))
    sp_combined = (site_plan_result or {}).get("basin")
    sp_num, _sp_name = _split_numbered_label(sp_combined)
    if not deed_num or not sp_num:
        return None
    if deed_num == _norm_id(sp_num):
        return None
    # Identity mismatch — same reasoning as plot mismatch above.
    return _row(
        "deed_site_plan_basin_mismatch",
        DOC_DEED_VS_SITE_PLAN,
        f"رقم الحوض في السند ({pdf_result.get('basin_number')}) لا يطابق ما هو "
        f"مدوّن في مخطط الموقع التنظيمي ({sp_combined})",
        "تأكد من أن السند ومخطط الموقع التنظيمي يخصّان نفس الحوض",
        blocking=True,
    )


def cross_doc_village_mismatch(pdf_result: dict, site_plan_result: dict) -> dict | None:
    deed_name = _norm_id((pdf_result or {}).get("village_name"))
    sp_combined = (site_plan_result or {}).get("village")
    _sp_num, sp_name = _split_numbered_label(sp_combined)
    if not deed_name or not sp_name:
        return None
    if deed_name == _norm_id(sp_name):
        return None
    # Identity mismatch — same reasoning as plot mismatch above.
    return _row(
        "deed_site_plan_village_mismatch",
        DOC_DEED_VS_SITE_PLAN,
        f"اسم القرية في السند ({pdf_result.get('village_name')}) لا يطابق ما هو "
        f"مدوّن في مخطط الموقع التنظيمي ({sp_combined})",
        "تأكد من أن السند ومخطط الموقع التنظيمي يخصّان نفس القرية",
        blocking=True,
    )


def cross_doc_floors_exceed_max(floor_result: dict, site_plan_result: dict) -> dict | None:
    actual = _to_int((floor_result or {}).get("num_floors"))
    allowed = _to_int((site_plan_result or {}).get("max_floors"))
    if actual is None or allowed is None or allowed <= 0:
        return None
    if actual <= allowed:
        return None
    return _row(
        "floors_exceed_max",
        DOC_FLOOR_VS_SITE_PLAN,
        f"عدد الطوابق المقترح ({actual}) يتجاوز الحد الأقصى المسموح ({allowed})",
        f"تخفيض عدد الطوابق إلى {allowed} أو أقل بما يتوافق مع مخطط الموقع التنظيمي",
    )


def cross_doc_floor_ratio_violation(
    floor_result: dict, pdf_result: dict, site_plan_result: dict,
) -> dict | None:
    """Floor coverage ratio (Σ floor area ÷ deed lot area) vs allowed
    floor_ratio_pct from the regulatory site plan."""
    floor_sum = _to_float((floor_result or {}).get("floor_area_sum"))
    if floor_sum is None:
        # Fallback for v3 archives that didn't carry the filtered sum.
        floor_sum = _to_float((floor_result or {}).get("printed_grand_total"))
    lot_area = _to_float((pdf_result or {}).get("area_m2"))
    allowed_pct = _to_float((site_plan_result or {}).get("floor_ratio_pct"))
    if floor_sum is None or lot_area is None or allowed_pct is None or lot_area <= 0:
        return None
    actual_pct = (floor_sum / lot_area) * 100.0
    if actual_pct <= allowed_pct + FLOOR_RATIO_EPSILON_PCT:
        return None
    return _row(
        "floor_ratio_exceeds_allowed",
        DOC_FLOOR_RATIO,
        f"نسبة التغطية الطابقية الفعلية {_fmt_pct(actual_pct)} تتجاوز النسبة "
        f"المسموحة {_fmt_pct(allowed_pct)}",
        f"تخفيض المساحات الطابقية بحيث لا تتجاوز {_fmt_pct(allowed_pct)} من "
        "مساحة القطعة",
    )


def compliance_zoning_unresolved(cad_result: dict) -> dict | None:
    """Block submission when the deed/site-plan zoning category couldn't
    be matched against the per-category fines table — without a category,
    the JOD/m² rate for setback / building / floor fines is unknown.

    Fires when compliance ran (we have a fine_jd or violation area) but
    the zoning lookup produced no rates. The submitter is asked to fix
    the deed PDF (the zoning_region field) so the rate can resolve.
    """
    compliance = (cad_result or {}).get("compliance") or {}
    if not compliance:
        return None
    if not compliance.get("zoning_unresolved"):
        return None
    used = compliance.get("zoning_category_used")
    if used:
        issue = (
            f"تعذّر مطابقة فئة التنظيم \"{used}\" مع جدول الغرامات الرسمي — "
            "غرامات الارتدادات / مساحة المبنى / التغطية الطابقية غير قابلة للاحتساب"
        )
    else:
        issue = (
            "فئة التنظيم (منطقة التنظيم) غير مستخرجة من السند — "
            "غرامات الارتدادات / مساحة المبنى / التغطية الطابقية غير قابلة للاحتساب"
        )
    return _row(
        "compliance_zoning_unresolved",
        DOC_DEED_VS_SITE_PLAN,
        issue,
        "تأكد من تعبئة حقل \"منطقة التنظيم\" في السند بإحدى الفئات المعتمدة "
        "(سكن أ/ب/ج/د، السكن الأخضر/الخاص/الريفي/الزراعي/الشعبي، التجاري، "
        "الصناعات، المكاتب، متعدد الاستعمال)",
        blocking=True,
    )


def cross_document_issues(
    *,
    pdf_result: dict | None,
    cad_result: dict | None,
    floor_result: dict | None,
    site_plan_result: dict | None,
) -> list[dict]:
    """Run every cross-document check and return the missing-data rows for
    the discrepancies that fired. Site-plan-dependent checks are gated by
    `site_plan_result.status == 'ok'` so we don't emit noise when the
    regulatory PDF was wrong/unreadable (those failures already produce
    their own dedicated rows)."""
    pdf_result = pdf_result or {}
    cad_result = cad_result or {}
    floor_result = floor_result or {}
    site_plan_result = site_plan_result or {}

    rows: list[dict] = []
    r = compliance_zoning_unresolved(cad_result)
    if r:
        rows.append(r)
    r = cross_doc_lot_area_mismatch(pdf_result, cad_result)
    if r:
        rows.append(r)

    site_plan_ok = (site_plan_result.get("status") == "ok")
    if site_plan_ok:
        for fn in (
            cross_doc_plot_mismatch,
            cross_doc_basin_mismatch,
            cross_doc_village_mismatch,
        ):
            r = fn(pdf_result, site_plan_result)
            if r:
                rows.append(r)
        r = cross_doc_floors_exceed_max(floor_result, site_plan_result)
        if r:
            rows.append(r)
        r = cross_doc_floor_ratio_violation(floor_result, pdf_result, site_plan_result)
        if r:
            rows.append(r)

    return rows


# ─── Missing-data row → document slot mapping ─────────────────────────────
# Used by the resubmit flow to figure out which of the 4 drop zones to show
# the engineer. We key off the row's `key` field (not the document label)
# so the mapping is stable against Arabic copy changes.

# Slot names match the FastAPI form field names on /api/jobs:
#   "cad"           → file       (CAD drawing)
#   "pdf_deed"      → pdf_deed   (سند التسجيل)
#   "pdf_floor"     → pdf_floor  (خطة مساحة الطابقية)
#   "pdf_site_plan" → pdf_site_plan (مخطط موقع تنظيمي)
ALL_DOC_SLOTS = ("cad", "pdf_deed", "pdf_floor", "pdf_site_plan")

# Mapping is stored as tuples uniformly; cross-document rows implicate
# multiple slots (e.g. a deed-vs-CAD lot-area mismatch could be fixed in
# either document, so the resubmit form should expose both).
_KEY_TO_SLOTS: dict[str, tuple[str, ...]] = {
    # CAD layer / geometry issues
    "cad_missing_building_layer": ("cad",),
    "cad_missing_lot_layer": ("cad",),
    "cad_missing_street_layer": ("cad",),
    "cad_building_empty": ("cad",),
    "cad_lot_empty": ("cad",),
    "cad_building_open": ("cad",),
    "cad_lot_open": ("cad",),
    "cad_building_outside_lot": ("cad",),
    # Compliance violations — CAD is what the engineer adjusts to comply.
    "coverage_exceeds_allowed": ("cad",),
    "setback_violation": ("cad",),
    # Site plan issues
    "site_plan_wrong_doc": ("pdf_site_plan",),
    "site_plan_unreadable": ("pdf_site_plan",),
    # Cross-document discrepancies — implicate multiple slots because
    # either side could carry the wrong value.
    "deed_cad_lot_area_mismatch": ("cad", "pdf_deed"),
    "deed_site_plan_plot_mismatch": ("pdf_deed", "pdf_site_plan"),
    "deed_site_plan_basin_mismatch": ("pdf_deed", "pdf_site_plan"),
    "deed_site_plan_village_mismatch": ("pdf_deed", "pdf_site_plan"),
    "floors_exceed_max": ("pdf_floor", "pdf_site_plan", "cad"),
    "floor_ratio_exceeds_allowed": ("pdf_floor", "pdf_site_plan", "cad"),
}


def flagged_documents(rows: list[dict]) -> dict[str, bool]:
    """Return a slot→bool map showing which of the 4 documents the
    missing-data rows implicate. A single row may implicate multiple slots
    (cross-document discrepancies). Empty rows → every slot is False (caller
    can decide what to do in that edge case)."""
    out = {slot: False for slot in ALL_DOC_SLOTS}
    for r in rows or []:
        slots = _KEY_TO_SLOTS.get(r.get("key") or "")
        if not slots:
            continue
        for slot in slots:
            if slot in out:
                out[slot] = True
    return out
