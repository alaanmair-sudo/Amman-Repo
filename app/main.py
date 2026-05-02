"""FastAPI app: upload endpoint, SSE stream, static frontend.

Run with:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time as _time
import uuid as _uuid
from pathlib import Path

import yaml


def _unique_upload_path(upload_dir: Path, filename: str | None) -> Path:
    """Compose a write-safe upload path that won't collide with files locked by
    another process (typical: AutoCAD still has the previous run's DWG open
    with an exclusive Windows lock, so re-uploading the same name fails with
    PermissionError). Prefixing with a timestamp + short uuid sidesteps it
    completely while keeping the original filename in the suffix for grep-
    ability on disk.
    """
    name = filename or "upload"
    ts = _time.strftime("%Y%m%d_%H%M%S")
    rand = _uuid.uuid4().hex[:6]
    return upload_dir / f"{ts}_{rand}_{name}"


# Windows consoles default to cp1252 — any raw `print(...)` that includes
# Arabic filenames (deed, floor plan, مخطط موقع تنظيمي) would crash with
# UnicodeEncodeError and bubble up as a 500 from the upload endpoint.
# Reconfigure once at startup; errors='replace' guarantees we never crash on
# an unmappable character even after this.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (no python-dotenv dep). Lines like KEY=value, # for comments."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and not os.environ.get(k):
            os.environ[k] = v


_load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from fastapi import Depends, FastAPI, HTTPException, UploadFile, File, Form, Body
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from app.agent import run_agent
from app.auth import (
    authenticate,
    current_user,
    issue_token,
    require_role,
)
from app.jobs import store


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
STATIC_DIR = Path(__file__).parent / "static"
ANALYSIS_DIR = ROOT / "analysis"
_ANALYSIS_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")

# Matches `/static/<path>?v=<digits>` in served HTML so we can rewrite the
# version query string from each asset file's mtime. Means asset-cache busts
# happen automatically on save — no more manual `?v=72` bumps in index.html.
_ASSET_VERSION_RE = re.compile(r"/static/([\w./\-]+?)\?v=\d+")


def _versioned_html(html_path: Path) -> HTMLResponse:
    """Serve `html_path` with every `/static/...?v=N` query string rewritten
    to the int mtime of the matching file under `STATIC_DIR`. Files that
    don't exist on disk keep their original version (caller typo).
    """
    text = html_path.read_text(encoding="utf-8")

    def _swap(m: re.Match) -> str:
        rel = m.group(1)
        asset = STATIC_DIR / rel
        try:
            mtime = int(asset.stat().st_mtime)
        except FileNotFoundError:
            return m.group(0)
        return f"/static/{rel}?v={mtime}"

    return HTMLResponse(_ASSET_VERSION_RE.sub(_swap, text))


def _load_cfg() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


app = FastAPI(title="Building Setback Analyzer")


# Startup banner — prints once when uvicorn loads this module. If you don't see
# this in your terminal after a code change, `--reload` didn't pick up the
# change and you need to Ctrl+C and relaunch.
_STARTUP_TAG = "v10-personas"
print(
    f"[main] loaded ({_STARTUP_TAG}) — submitter/reviewer personas gated by "
    f"users.json; endpoints require Authorization: Bearer <token>",
    flush=True,
)


_VALID_APP_TYPES = {
    "initial_consultation",
    "technical_consultation",
    "permit_vacant_land",
    "permit_over_existing",
    "amended_plan_permit",
    "permit_cancellation",
    "occupancy_permit",
    "occupancy_renewal",
    "occupancy_doc_correction",
    "occupancy_renewal_doc_correction",
    "additions_permit",
    "additions_permit_with_occupancy",
    "existing_areas_permit_with_occupancy",
    "first_time_existing_building",
    "deposit_forfeiture",
    "central_committee_review",
    "other",
}
_VALID_REVIEW_STATUSES = {"draft", "pending", "approved", "rejected", "needs_revision"}


# ── Auth endpoints ─────────────────────────────────────────────────────────

@app.post("/api/auth/login")
async def login(body: dict = Body(...)):
    """Demo login: username + password checked against users.json.
    Returns a never-expiring bearer token the client stores and attaches to
    every subsequent request via `Authorization: Bearer <token>`."""
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = authenticate(username, password)
    if user is None:
        raise HTTPException(401, "Invalid username or password")
    token = issue_token(user)
    return {
        "token": token,
        "user": {
            "username": user["username"],
            "role": user["role"],
            "display_name": user.get("display_name") or user["username"],
        },
    }


@app.get("/api/auth/me")
async def whoami(user: dict = Depends(current_user)):
    """Return the caller's identity. Used by the frontend on page load to
    verify the stored token is still valid (covers the case where users.json
    was edited and the role changed / user was removed)."""
    return {"user": user}


@app.post("/api/jobs")
async def create_job(
    file: UploadFile | None = File(None),
    pdf_deed: UploadFile | None = File(None),
    pdf_floor: UploadFile | None = File(None),
    # Regulatory site plan ("مخطط موقع تنظيمي") — supplies the required
    # setbacks (front/side/rear) used by the compliance check.
    pdf_site_plan: UploadFile | None = File(None),
    # Additional PDFs uploaded in the same flow as the deed. Each one is
    # extracted independently in parallel and rendered as its own card.
    pdf_extras: list[UploadFile] = File(default_factory=list),
    # Optional measurement PDF — a vector PDF export of the drawing,
    # used only by the in-browser PDF.js measurement viewer on the
    # post-analysis page. NOT fed into any analysis pipeline; just stored
    # on disk and surfaced via /api/analyses/{id}/files/pdf_measurement.
    pdf_measurement: UploadFile | None = File(None),
    # Back-compat alias: older clients that still POST `pdf` get treated as the deed
    pdf: UploadFile | None = File(None),
    meta_json: str | None = Form(None),
    user: dict = Depends(require_role("submitter")),
):
    deed_upload = pdf_deed if pdf_deed is not None else pdf
    # FastAPI gives us `[<UploadFile filename='' …>]` when the form field is
    # absent-but-declared; filter those ghost uploads out so we don't spawn
    # tasks for non-existent files.
    extras_clean = [u for u in (pdf_extras or []) if u is not None and (u.filename or "").strip()]
    measurement_present = pdf_measurement is not None and (pdf_measurement.filename or "").strip()
    print(
        f"[main] POST /api/jobs  file={file.filename if file else None!r}  "
        f"pdf_deed={deed_upload.filename if deed_upload else None!r}  "
        f"pdf_floor={pdf_floor.filename if pdf_floor else None!r}  "
        f"pdf_site_plan={pdf_site_plan.filename if pdf_site_plan else None!r}  "
        f"pdf_extras={[u.filename for u in extras_clean]!r}  "
        f"pdf_measurement={pdf_measurement.filename if measurement_present else None!r}",
        flush=True,
    )
    # File presence is enforced on the frontend (the Analyze button only
    # enables when all 4 required files are picked). The server keeps a
    # minimal defensive 400 for malformed requests — never the user-facing
    # path. Content issues (missing layers, unreadable site plan, etc.) are
    # surfaced as `missing_data` rows during the pipeline and shown in the
    # review panel, not returned as a validation error.
    if file is None:
        raise HTTPException(400, "CAD file is required")

    cfg = _load_cfg()
    upload_dir = ROOT / cfg.get("agent", {}).get("upload_dir", "uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)

    body = await file.read()
    dest = _unique_upload_path(upload_dir, file.filename or "drawing")
    dest.write_bytes(body)
    cad_filename = file.filename or "drawing"
    cad_bytes = len(body)
    cad_path = str(dest)

    meta: dict = {}
    if meta_json:
        try:
            raw_meta = json.loads(meta_json)
            if isinstance(raw_meta, dict):
                meta = raw_meta
        except json.JSONDecodeError:
            pass
    app_type = meta.get("application_type")
    if app_type not in _VALID_APP_TYPES:
        meta["application_type"] = "initial_consultation"
    # Submitters start in `draft`: the AI runs the full analysis but the
    # reviewer's queue does not see the application until the submitter
    # explicitly clicks "Submit to reviewer" (POST /submit, below). Reviewers
    # uploading directly skip the draft step and land in `pending` as before.
    initial_status = "draft" if user.get("role") == "submitter" else "pending"
    meta["review_status"] = initial_status
    meta["submitted_with_known_issues"] = False
    # `submitted_by` is authoritative from the session — never trust the
    # client-supplied value. The reviewer timeline displays the submitter's
    # display_name so the reviewer sees "Akram Atteyeh" not "akram_atteyeh".
    meta["submitted_by"] = user["username"]
    meta["submitted_by_display"] = user.get("display_name") or user["username"]
    meta.setdefault("reviewer_notes", "")
    # Seed the communication timeline. For drafts we record a "draft started"
    # entry; the actual "submission" entry is appended later by /submit. For
    # reviewer-uploaded apps we keep the legacy single-step "submission" seed.
    if initial_status == "draft":
        meta["reviewer_notes_history"] = [{
            "timestamp": _time.strftime("%Y-%m-%dT%H:%M:%S"),
            "reviewer_username": user["username"],
            "reviewer_display": user.get("display_name") or user["username"],
            "status_before": "",
            "status_after": "draft",
            "note": "تم إنشاء مسودة الطلب وبدء التحليل الذكي.",
            "kind": "draft_started",
        }]
    else:
        meta["reviewer_notes_history"] = [{
            "timestamp": _time.strftime("%Y-%m-%dT%H:%M:%S"),
            "reviewer_username": user["username"],
            "reviewer_display": user.get("display_name") or user["username"],
            "status_before": "",
            "status_after": "pending",
            "note": "تم تقديم الطلب.",
            "kind": "submission",
        }]

    job = await store.create(
        filename=cad_filename, file_bytes=cad_bytes, input_path=cad_path, meta=meta,
    )

    # All four pipelines are now guaranteed to run — the upload passed phase-1
    # presence checks above, so we set every expected flag before kicking off
    # any task. This prevents _maybe_finalize from closing the job early.
    job.pdf_expected = True
    job.floor_expected = True
    job.site_plan_expected = True
    if extras_clean:
        job.extras_expected = len(extras_clean)
        # Pre-allocate result slots keyed by the upload order. Each extras
        # task fills its slot by index when it finishes.
        job.extras_results = [
            {"filename": u.filename or f"extra_{i}.pdf", "status": "pending"}
            for i, u in enumerate(extras_clean)
        ]

    asyncio.create_task(run_agent(job, cfg))

    # Persist every uploaded file's on-disk path onto meta.file_paths so the
    # partial-resubmit flow can carry unchanged documents forward without
    # re-uploading. The dict is keyed by the form field name ("cad",
    # "pdf_deed", "pdf_floor", "pdf_site_plan", "pdf_extras").
    file_paths: dict = {"cad": cad_path, "pdf_extras": []}

    # --- Deed PDF (سند التسجيل) ---
    deed_bytes = await deed_upload.read()
    deed_dest = _unique_upload_path(upload_dir, deed_upload.filename)
    deed_dest.write_bytes(deed_bytes)
    file_paths["pdf_deed"] = str(deed_dest)
    file_paths["pdf_deed_filename"] = deed_upload.filename or "deed.pdf"
    from app.pdf_analyzer import analyze_pdf
    asyncio.create_task(analyze_pdf(job, deed_bytes, cfg))

    # --- Floor-plan-area PDF (خطة مساحة الطابقية) ---
    floor_bytes = await pdf_floor.read()
    floor_dest = _unique_upload_path(upload_dir, pdf_floor.filename)
    floor_dest.write_bytes(floor_bytes)
    file_paths["pdf_floor"] = str(floor_dest)
    file_paths["pdf_floor_filename"] = pdf_floor.filename or "floor.pdf"
    from app.floor_plan_analyzer import analyze_floor_plan
    asyncio.create_task(analyze_floor_plan(job, floor_bytes, cfg))

    # --- Site-plan PDF (مخطط موقع تنظيمي) ---
    site_plan_bytes = await pdf_site_plan.read()
    site_plan_dest = _unique_upload_path(upload_dir, pdf_site_plan.filename)
    site_plan_dest.write_bytes(site_plan_bytes)
    file_paths["pdf_site_plan"] = str(site_plan_dest)
    file_paths["pdf_site_plan_filename"] = pdf_site_plan.filename or "site_plan.pdf"
    from app.site_plan_extractor import analyze_site_plan
    asyncio.create_task(analyze_site_plan(job, site_plan_bytes, cfg))

    # --- Optional measurement PDF (no pipeline; viewer-only) ---
    if measurement_present:
        m_bytes = await pdf_measurement.read()
        m_dest = _unique_upload_path(upload_dir, pdf_measurement.filename)
        m_dest.write_bytes(m_bytes)
        file_paths["pdf_measurement"] = str(m_dest)
        file_paths["pdf_measurement_filename"] = pdf_measurement.filename or "measurement.pdf"

    # --- Optional parallel additional-PDFs pipeline (N files) ---
    if extras_clean:
        from app.pdf_analyzer import analyze_extra_pdf
        for i, extra in enumerate(extras_clean):
            # Phase-1 already verified each extras file is a .pdf.
            ebytes = await extra.read()
            extra_dest = _unique_upload_path(upload_dir, extra.filename)
            extra_dest.write_bytes(ebytes)
            file_paths["pdf_extras"].append({
                "path": str(extra_dest),
                "filename": extra.filename or f"extra_{i}.pdf",
            })
            asyncio.create_task(
                analyze_extra_pdf(job, ebytes, cfg, index=i, filename=extra.filename or f"extra_{i}.pdf")
            )

    job.meta["file_paths"] = file_paths
    job.meta["cad_filename"] = cad_filename

    # Save a stub record NOW so the submitter's dashboard shows the row
    # immediately with status=running ("قيد التحليل"). The finalizer's
    # _save_analysis() overwrites this with full results when the pipeline
    # completes. analysis_id = the filename stem the dashboard uses.
    from app.jobs import _save_stub
    stub_path = _save_stub(job)
    analysis_id = Path(stub_path).stem

    return {
        "job_id": job.id,
        "analysis_id": analysis_id,
        "filename": job.filename,
        "bytes": job.file_bytes,
        "has_pdf": True,
        "has_pdf_deed": True,
        "has_pdf_floor": True,
        "has_pdf_site_plan": True,
        "extras_count": len(extras_clean),
        "extras_filenames": [u.filename for u in extras_clean],
    }


@app.get("/api/jobs/{job_id}/events")
async def stream_events(job_id: str):
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    async def gen():
        # Hold the CAD pipeline's `done` event until every expected side
        # pipeline (deed PDF, floor-plan PDF, each additional PDF) has also
        # finished, so post-`done` events aren't dropped by clients that close
        # on `done`.
        held_done_event = None
        pending: set[str] = set()
        if job.pdf_expected:
            pending.add("pdf")
        if job.floor_expected:
            pending.add("floor")
        if job.site_plan_expected:
            pending.add("site_plan")
        # Extras: one pending token per uploaded file, keyed by index.
        for i in range(job.extras_expected):
            pending.add(f"extra:{i}")

        while True:
            event = await job.events.get()
            kind = event["kind"]

            if kind == "done" and pending:
                held_done_event = event
                continue  # don't emit yet — wait for side pipelines

            yield {"event": kind, "data": json.dumps({k: v for k, v in event.items() if k != "kind"})}

            if kind in ("pdf_done", "pdf_error"):
                pending.discard("pdf")
            elif kind in ("floor_done", "floor_error"):
                pending.discard("floor")
            elif kind in ("site_plan_done", "site_plan_error"):
                pending.discard("site_plan")
            elif kind in ("extra_done", "extra_error"):
                idx = event.get("index")
                if idx is not None:
                    pending.discard(f"extra:{idx}")

            if held_done_event is not None and not pending:
                e = held_done_event
                yield {"event": e["kind"], "data": json.dumps({k: v for k, v in e.items() if k != "kind"})}
                break

            if kind == "done":
                # Only reached when no side pipeline was expected (normal close)
                break

    return EventSourceResponse(gen())


@app.get("/api/jobs/{job_id}/result")
async def get_result(job_id: str):
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "status": job.status,
        "error": job.error,
        "result": job.result,
    }


def _resolve_analysis_path(analysis_id: str, *, include_archived: bool = False) -> Path:
    """Validate the id and return the matching file path under ANALYSIS_DIR.

    By default this only resolves *live* analyses (the ones in ANALYSIS_DIR
    itself, which is what the dashboard listing scans). Pass
    `include_archived=True` to fall back to `ANALYSIS_DIR/archive/<id>.archived.json`
    when no live record exists — used by the read-only history viewer.
    """
    if not _ANALYSIS_ID_RE.match(analysis_id):
        raise HTTPException(400, "invalid analysis id")
    base = ANALYSIS_DIR.resolve()
    p = (base / f"{analysis_id}.json").resolve()
    if str(p).startswith(str(base)) and p.is_file():
        return p
    if include_archived:
        ap = (base / "archive" / f"{analysis_id}.archived.json").resolve()
        if str(ap).startswith(str(base)) and ap.is_file():
            return ap
    raise HTTPException(404, "analysis not found")


def _extract_owner(pdf_result: dict | None) -> str:
    """Pull the owner name from the deed PDF's `other_fields` list."""
    if not pdf_result:
        return ""
    for f in pdf_result.get("other_fields") or []:
        label = (f or {}).get("label") or ""
        if "المالك" in label or "owner" in label.lower():
            return str((f or {}).get("value") or "")
    return ""


def _flagged_docs_from(data: dict) -> dict:
    """Map persisted missing_data rows → per-document-slot booleans. Used
    by the submitter's resubmit form to render only the drop zones whose
    files the reviewer actually flagged."""
    from app.validation import flagged_documents, ALL_DOC_SLOTS
    rows = list(data.get("missing_data") or [])
    flags = flagged_documents(rows)
    # Fallback: if the pipeline returned the app to needs_revision WITHOUT
    # any missing_data rows (edge case where the reviewer wrote a free-form
    # note only), expose all 4 slots so the submitter can still fix things.
    meta = data.get("meta") or {}
    if meta.get("review_status") == "needs_revision" and not any(flags.values()):
        flags = {slot: True for slot in ALL_DOC_SLOTS}
    return flags


def _summarize_analysis(data: dict, file_id: str, size: int | None = None) -> dict:
    """Flatten a saved analysis JSON into a dashboard-friendly summary."""
    result = data.get("result") or {}
    pdf = data.get("pdf_result") or {}
    floor = data.get("floor_result") or {}
    site_plan = data.get("site_plan_result") or {}
    meta = data.get("meta") or {}

    per_side = result.get("per_side") or {}
    coverage_pct = result.get("coverage_pct")
    building_area = result.get("building_area")
    lot_area = result.get("lot_area")
    compliance = result.get("compliance") or {}

    return {
        "id": file_id,
        "filename": data.get("filename") or file_id,
        "size": size,
        "status": data.get("status"),
        "error": data.get("error"),
        "created_at": data.get("created_at"),
        "finished_at": data.get("finished_at"),
        "has_pdf": bool(data.get("pdf_expected")),
        "has_floor": bool(data.get("floor_expected")),
        "has_site_plan": bool(data.get("site_plan_expected")),
        "extras_count": len(data.get("extras_results") or []),
        # Application metadata
        "application_type": meta.get("application_type") or "initial_consultation",
        "review_status": meta.get("review_status") or "pending",
        "submitted_with_known_issues": bool(meta.get("submitted_with_known_issues")),
        "approved_with_open_issues": bool(meta.get("approved_with_open_issues")),
        "submitted_by": meta.get("submitted_by") or "",
        "submitted_by_display": meta.get("submitted_by_display") or meta.get("submitted_by") or "",
        "reviewer_notes": meta.get("reviewer_notes") or "",
        "reviewer_notes_history": list(meta.get("reviewer_notes_history") or []),
        "missing_data": list(data.get("missing_data") or []),
        "flagged_documents": _flagged_docs_from(data),
        "file_paths": meta.get("file_paths") or {},
        "cad_filename": meta.get("cad_filename") or data.get("filename") or "",
        "meta_updated_at": meta.get("updated_at"),
        # Carryforward signals from the prior round (resubmit chain). Empty
        # for fresh first-round analyses. The keys are persisted on meta by
        # the resubmit handler so the UI can show "previous reviewer comment"
        # callouts and "✓ resolved" strips without a second fetch.
        "previous_round_keys": list(meta.get("previous_round_keys") or []),
        "previous_round_comments": dict(meta.get("previous_round_comments") or {}),
        "previous_round_summary": dict(meta.get("previous_round_summary") or {}),
        # Revision chain — surface archive markers so the UI can label this
        # version as a prior revision and link to its successor.
        "previous_analysis_id": meta.get("previous_analysis_id"),
        "archived_at": meta.get("archived_at"),
        "superseded_by": meta.get("superseded_by"),
        "is_archived": bool(meta.get("archived_at")),
        # Deed-derived
        "owner": _extract_owner(pdf),
        "basin_name": pdf.get("basin_name") or "",
        "basin_number": pdf.get("basin_number") or "",
        "village_name": pdf.get("village_name") or "",
        "plot_number": pdf.get("plot_number") or "",
        "deed_area_m2": pdf.get("area_m2"),
        "deed_area_text": pdf.get("area") or "",
        # CAD-derived
        "building_area": building_area,
        "lot_area": lot_area,
        "coverage_pct": coverage_pct,
        "per_side": per_side,
        "edge_count": result.get("edge_count"),
        # Floor-plan derived. The pipeline stopped reconciling building-level
        # totals (no Python equivalent of the printed grand) so the summary
        # only carries what the UI actually consumes today: the printed
        # building-level total and the licensed total.
        "floor_printed_total": floor.get("printed_grand_total"),
        "floor_licensed_total": floor.get("licensed_total"),
        # Compliance derived (مخطط موقع تنظيمي)
        "site_plan_status": site_plan.get("status") or (
            "missing" if not data.get("site_plan_expected") else "unknown"
        ),
        "required_front_m": site_plan.get("front_setback_m"),
        "required_side_m": site_plan.get("side_setback_m"),
        "required_rear_m": site_plan.get("rear_setback_m"),
        "is_corner_lot": site_plan.get("is_corner_lot"),
        "compliance_violation_area_m2": compliance.get("total_violation_area_m2"),
        "compliance_fine_jd": compliance.get("fine_jd"),
        "compliance_envelope_infeasible": compliance.get("envelope_infeasible"),
        "compliance_is_serious": compliance.get("is_serious"),
        "compliance_lot_crossing_area_m2": compliance.get("lot_crossing_area_m2"),
    }


def _owns_analysis(user: dict, data: dict) -> bool:
    """Submitter-only ownership check: the logged-in username must match the
    `submitted_by` field persisted on the analysis. Reviewers bypass this."""
    if user["role"] == "reviewer":
        return True
    meta = data.get("meta") or {}
    return meta.get("submitted_by") == user["username"]


def _is_visible_to(user: dict, data: dict) -> bool:
    """List-visibility filter (broader than ownership). Reviewers see every
    submitted application but NOT drafts that are still in the submitter's
    pre-submit preview. Submitters see their own analyses regardless of
    status (including their own drafts)."""
    meta = data.get("meta") or {}
    status = meta.get("review_status") or "pending"
    if user["role"] == "reviewer":
        return status != "draft"
    return meta.get("submitted_by") == user["username"]


def _is_chain_visible_to(user: dict, data: dict) -> bool:
    """Same as _is_visible_to but follows `meta.superseded_by` forward when
    the entry itself is hidden, so the live tip's visibility carries to its
    whole archived history.

    Why: reviewers can see submitted apps but not drafts. Each resubmit
    archives the prior version with `status="draft"` retained, so the
    chain walker (used by /history and /files) would otherwise hit an
    archived draft predecessor and stop — the reviewer would see only the
    current round, not the per-round AI feedback or downloadable prior
    files. The chain is one user's revision tree (`previous_analysis_id`
    is set only by the resubmit handler, which is ownership-gated), so
    inheriting visibility from the live tip is safe."""
    if _is_visible_to(user, data):
        return True
    cur_meta = data.get("meta") or {}
    seen: set[str] = set()
    next_id = cur_meta.get("superseded_by") or ""
    while next_id and next_id not in seen:
        seen.add(next_id)
        try:
            nxt_path = _resolve_analysis_path(next_id, include_archived=True)
        except HTTPException:
            return False
        try:
            nxt = json.loads(nxt_path.read_text(encoding="utf-8"))
        except Exception:
            return False
        if _is_visible_to(user, nxt):
            return True
        next_id = (nxt.get("meta") or {}).get("superseded_by") or ""
    return False


@app.get("/api/analyses")
async def list_analyses(user: dict = Depends(current_user)):
    """List analyses the caller can see.
      · Reviewer → every saved analysis, newest first
      · Submitter → only analyses where meta.submitted_by matches their username
    """
    if not ANALYSIS_DIR.exists():
        return {"items": []}
    items: list[dict] = []
    for p in sorted(ANALYSIS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not _is_visible_to(user, data):
            continue
        items.append(_summarize_analysis(data, p.stem, size=p.stat().st_size))
    return {"items": items}


@app.patch("/api/analyses/{analysis_id}/meta")
async def update_analysis_meta(
    analysis_id: str,
    payload: dict = Body(...),
    user: dict = Depends(require_role("reviewer")),
):
    """Reviewer-only: update application metadata. Status changes + non-empty
    `reviewer_notes` are appended to `reviewer_notes_history` as a timeline
    entry so previous decisions are never lost across revision cycles."""
    p = _resolve_analysis_path(analysis_id)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(500, f"unreadable analysis: {exc}") from exc

    meta = dict(data.get("meta") or {})
    status_before = meta.get("review_status", "pending")
    status_after = status_before
    note_text = ""
    # Optional: reviewer is approving while the AI table still shows open
    # rows. Frontend sets this to true on the approve-with-open-issues
    # confirm path; the flag is persisted on meta + stamped onto the
    # timeline entry so the dashboard / audit trail can surface it later.
    approved_with_open_issues = False
    if "approved_with_open_issues" in payload:
        approved_with_open_issues = bool(payload.get("approved_with_open_issues"))

    if "application_type" in payload:
        at = payload["application_type"]
        if at not in _VALID_APP_TYPES:
            raise HTTPException(400, f"invalid application_type: {at}")
        meta["application_type"] = at
    if "review_status" in payload:
        rs = payload["review_status"]
        if rs not in _VALID_REVIEW_STATUSES:
            raise HTTPException(400, f"invalid review_status: {rs}")
        # Approved / rejected are final — refuse to un-do them.
        if status_before in {"approved", "rejected"} and rs != status_before:
            raise HTTPException(400, f"application is {status_before} — decision is final")
        meta["review_status"] = rs
        status_after = rs
        # Stamp the per-round flag onto meta only on the approve transition
        # so a subsequent meta-only PATCH (e.g. application_type fix) can't
        # accidentally mark the application as "approved with open issues".
        if rs == "approved":
            meta["approved_with_open_issues"] = approved_with_open_issues
    if "reviewer_notes" in payload:
        note_text = str(payload.get("reviewer_notes") or "")
        meta["reviewer_notes"] = note_text

    # Per-row reviewer comments on missing_data. Payload shape:
    #   {"missing_data_comments": {"<row_key>": "<comment text>", ...}}
    # An empty/None value clears the comment for that row. Unknown keys
    # are ignored (no auto-creation of synthetic missing_data rows).
    if "missing_data_comments" in payload:
        raw_comments = payload.get("missing_data_comments") or {}
        if isinstance(raw_comments, dict):
            rows = list(data.get("missing_data") or [])
            for row in rows:
                if not isinstance(row, dict):
                    continue
                rk = row.get("key")
                if rk in raw_comments:
                    cmt = str(raw_comments.get(rk) or "").strip()
                    if cmt:
                        # Same 2000-char cap as resubmit notes.
                        row["reviewer_comment"] = cmt[:2000]
                    else:
                        row.pop("reviewer_comment", None)
            data["missing_data"] = rows

    # Per-row reviewer endorsements ("push" toggles). Payload shape:
    #   {"missing_data_endorsed": {"<row_key>": true|false, ...}}
    # When true, the AI-flagged row is promoted to the consultant's
    # mandatory list (and shown with a 🤖 pushed origin badge); when
    # false (or omitted), the row remains an advisory suggestion the
    # consultant may dismiss. Unknown keys are ignored. The two patches
    # may arrive together — we handle them in separate branches so a
    # comments-only or endorsements-only PATCH leaves the other field
    # untouched.
    if "missing_data_endorsed" in payload:
        raw_endorsed = payload.get("missing_data_endorsed") or {}
        if isinstance(raw_endorsed, dict):
            rows = list(data.get("missing_data") or [])
            for row in rows:
                if not isinstance(row, dict):
                    continue
                rk = row.get("key")
                if rk in raw_endorsed:
                    if bool(raw_endorsed.get(rk)):
                        row["reviewer_endorsed"] = True
                    else:
                        row.pop("reviewer_endorsed", None)
                        # Demoting also clears any reviewer_comment the
                        # reviewer typed before changing their mind, since
                        # the comment only made sense once the note was
                        # promoted to mandatory.
                        row.pop("reviewer_comment", None)
            data["missing_data"] = rows

    # Append a timeline entry when the reviewer either changed status OR
    # attached a non-empty note. Skip entries that touch nothing meaningful
    # (e.g. a no-op PATCH from the dashboard polling for fresh data).
    if status_after != status_before or note_text.strip():
        history = list(meta.get("reviewer_notes_history") or [])
        entry = {
            "timestamp": _time.strftime("%Y-%m-%dT%H:%M:%S"),
            "reviewer_username": user["username"],
            "reviewer_display": user.get("display_name") or user["username"],
            "status_before": status_before,
            "status_after": status_after,
            "note": note_text,
        }
        # Audit trail: surface that the reviewer chose to approve despite
        # the AI table still showing unresolved rows. Drives a "موافقة مع
        # ملاحظات" badge in the timeline + dashboard.
        if status_after == "approved" and approved_with_open_issues:
            entry["approved_with_open_issues"] = True
            entry["kind"] = "approved_with_issues"
        history.append(entry)
        meta["reviewer_notes_history"] = history

    from datetime import datetime as _dt
    meta["updated_at"] = _dt.now().isoformat(timespec="seconds")
    data["meta"] = meta

    p.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return _summarize_analysis(data, p.stem)


@app.get("/api/analyses/{analysis_id}")
async def get_analysis(
    analysis_id: str,
    include_archived: bool = False,
    include_events: bool = False,
    user: dict = Depends(current_user),
):
    """Reviewer: any submitted analysis (drafts hidden). Submitter: only
    analyses they submitted (including their own drafts).

    Pass `?include_archived=true` to read a prior revision out of the
    archive (used by the history viewer). Same visibility rules apply.

    The full SSE event log is excluded by default to keep this response
    fast — it can be tens of MB on long agent runs (assistant text deltas,
    tool results, base64 PNGs in `final`). Fetch it from
    `GET /api/analyses/{id}/events` instead. Pass `?include_events=true`
    if a single round-trip is genuinely needed (e.g. legacy clients).
    """
    p = _resolve_analysis_path(analysis_id, include_archived=include_archived)
    data = json.loads(p.read_text(encoding="utf-8"))
    if not _is_visible_to(user, data):
        # 404 (not 403) for reviewers asking about drafts so the existence
        # of the draft isn't leaked.
        if user["role"] == "reviewer":
            raise HTTPException(404, "analysis not found")
        raise HTTPException(403, "Not authorized for this application")
    # Strip the events array unless explicitly opted in. Frontend should
    # call /events for the replay stream so the main detail fetch stays
    # under a hundred KB even on big jobs.
    if not include_events:
        events = data.get("events") or []
        data = dict(data)
        data["events_count"] = len(events) if isinstance(events, list) else 0
        data.pop("events", None)
    return JSONResponse(data)


@app.get("/api/analyses/{analysis_id}/events")
async def get_analysis_events(
    analysis_id: str,
    include_archived: bool = False,
    offset: int = 0,
    limit: int = 0,
    user: dict = Depends(current_user),
):
    """Return the full SSE event log for a saved analysis. Split out of
    GET /api/analyses/{id} so the detail fetch is small and fast; this
    endpoint carries the heavy payload (assistant deltas, tool results,
    base64 PNG in the `final` event).

    Query params:
      · offset — skip the first N events (default 0)
      · limit  — return at most N events; 0 (default) means "all"
      · include_archived — read from archive/ when the live record is gone
    """
    p = _resolve_analysis_path(analysis_id, include_archived=include_archived)
    data = json.loads(p.read_text(encoding="utf-8"))
    if not _is_visible_to(user, data):
        if user["role"] == "reviewer":
            raise HTTPException(404, "analysis not found")
        raise HTTPException(403, "Not authorized for this application")
    events = data.get("events") or []
    if not isinstance(events, list):
        events = []
    total = len(events)
    if offset < 0:
        offset = 0
    sliced = events[offset:]
    if limit and limit > 0:
        sliced = sliced[:limit]
    return {
        "analysis_id": analysis_id,
        "total": total,
        "offset": offset,
        "count": len(sliced),
        "events": sliced,
    }


def _build_file_descriptors(analysis_id: str, meta: dict, data: dict) -> list[dict]:
    """Build a list of file descriptors for one analysis revision so the
    frontend can render download links without exposing absolute server
    paths. Skips slots that aren't on disk (back-compat: very old
    analyses that pre-date meta.file_paths only have CAD via input_path)."""
    paths = dict(meta.get("file_paths") or {})
    out: list[dict] = []
    for slot in ("cad", "pdf_deed", "pdf_floor", "pdf_site_plan", "pdf_measurement"):
        on_disk = paths.get(slot)
        if not on_disk and slot == "cad":
            on_disk = data.get("input_path")  # back-compat
        if not on_disk:
            continue
        if slot == "cad":
            filename = meta.get("cad_filename") or paths.get("cad_filename") or ""
        else:
            filename = paths.get(f"{slot}_filename") or ""
        if not filename:
            try:
                filename = Path(on_disk).name
            except Exception:
                filename = ""
        try:
            available = Path(on_disk).exists()
        except Exception:
            available = False
        out.append({
            "slot": slot,
            "filename": filename,
            "available": available,
            "url": f"/api/analyses/{analysis_id}/files/{slot}",
        })
    extras = paths.get("pdf_extras") or []
    for i, e in enumerate(extras):
        if not isinstance(e, dict):
            continue
        on_disk = e.get("path")
        if not on_disk:
            continue
        try:
            available = Path(on_disk).exists()
        except Exception:
            available = False
        out.append({
            "slot": f"pdf_extras_{i}",
            "filename": e.get("filename") or Path(on_disk).name,
            "available": available,
            "url": f"/api/analyses/{analysis_id}/files/pdf_extras_{i}",
        })
    return out


@app.get("/api/analyses/{analysis_id}/history")
async def get_analysis_history(
    analysis_id: str,
    user: dict = Depends(current_user),
):
    """Walk the revision chain backwards from the given analysis_id.
    Each resubmit appends `meta.previous_analysis_id` pointing at the
    prior version (now in `analysis/archive/`); this endpoint chases
    that link to the root and returns one summary per revision,
    ordered oldest → current.

    Each entry carries the round's full `missing_data` rows and a
    `files` list (slot + filename + download URL) so the reviewer panel
    can render documents-history + per-round issues without a second
    round-trip per revision.
    """
    chain: list[dict] = []
    cur_id = analysis_id
    seen: set[str] = set()
    while cur_id and cur_id not in seen:
        seen.add(cur_id)
        try:
            cur_path = _resolve_analysis_path(cur_id, include_archived=True)
        except HTTPException:
            break
        try:
            cur_data = json.loads(cur_path.read_text(encoding="utf-8"))
        except Exception:
            break
        if not _is_chain_visible_to(user, cur_data):
            break
        meta = cur_data.get("meta") or {}
        chain.append({
            "analysis_id": cur_id,
            "is_archived": bool(meta.get("archived_at")),
            "archived_at": meta.get("archived_at"),
            "superseded_by": meta.get("superseded_by"),
            "previous_analysis_id": meta.get("previous_analysis_id"),
            "review_status": meta.get("review_status"),
            "submitted_with_known_issues": bool(meta.get("submitted_with_known_issues")),
            "approved_with_open_issues": bool(meta.get("approved_with_open_issues")),
            "created_at": cur_data.get("created_at"),
            "finished_at": cur_data.get("finished_at"),
            "filename": cur_data.get("filename"),
            "missing_data_count": len(cur_data.get("missing_data") or []),
            "missing_data": list(cur_data.get("missing_data") or []),
            "files": _build_file_descriptors(cur_id, meta, cur_data),
        })
        cur_id = meta.get("previous_analysis_id") or ""
    chain.reverse()
    return {"history": chain}


@app.get("/api/analyses/{analysis_id}/files/{slot}")
async def download_analysis_file(
    analysis_id: str,
    slot: str,
    user: dict = Depends(current_user),
):
    """Stream the document for a given slot of an analysis (live OR
    archived). Slots: cad, pdf_deed, pdf_floor, pdf_site_plan,
    pdf_measurement (optional), plus pdf_extras_{i} for the optional
    0..N additional PDFs. Visibility
    is gated by the same `_is_visible_to` rule that protects the
    analysis JSON itself, so a submitter can only download files for
    their own application and reviewers can only download files on
    submitted apps (drafts hidden)."""
    p = _resolve_analysis_path(analysis_id, include_archived=True)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(500, f"unreadable analysis: {exc}") from exc
    # Use chain-aware visibility so reviewers can download files from
    # archived draft predecessors of a submitted app — without it the
    # download buttons in the timeline's per-round details 404 for the
    # reviewer (drafts always hidden) while working for the submitter.
    if not _is_chain_visible_to(user, data):
        if user.get("role") == "reviewer":
            raise HTTPException(404, "analysis not found")
        raise HTTPException(403, "Not authorized for this application")

    meta = data.get("meta") or {}
    paths = dict(meta.get("file_paths") or {})

    on_disk: str | None = None
    download_name: str = ""
    if slot in {"cad", "pdf_deed", "pdf_floor", "pdf_site_plan", "pdf_measurement"}:
        on_disk = paths.get(slot)
        if not on_disk and slot == "cad":
            on_disk = data.get("input_path")  # back-compat
        if slot == "cad":
            download_name = meta.get("cad_filename") or paths.get("cad_filename") or ""
        else:
            download_name = paths.get(f"{slot}_filename") or ""
    elif slot.startswith("pdf_extras_"):
        try:
            idx = int(slot.split("_")[-1])
        except ValueError as exc:
            raise HTTPException(400, "invalid extras index") from exc
        extras = paths.get("pdf_extras") or []
        if not (0 <= idx < len(extras)):
            raise HTTPException(404, "extras slot out of range")
        slot_data = extras[idx]
        if isinstance(slot_data, dict):
            on_disk = slot_data.get("path")
            download_name = slot_data.get("filename") or ""
    else:
        raise HTTPException(400, f"unknown slot: {slot}")

    if not on_disk:
        raise HTTPException(404, "file not on record for this slot")
    abs_path = Path(on_disk)
    if not abs_path.exists():
        # Files in `uploads/` get rotated periodically; stale paths still
        # appear in meta. 410 (Gone) tells the client the link was valid
        # at one point but the file is no longer available.
        raise HTTPException(410, "file no longer on disk")
    if not download_name:
        download_name = abs_path.name

    return FileResponse(
        path=abs_path,
        filename=download_name,
        media_type="application/octet-stream",
    )


@app.post("/api/analyses/{analysis_id}/submit")
async def submit_draft(
    analysis_id: str,
    payload: dict = Body(default_factory=dict),
    user: dict = Depends(require_role("submitter")),
):
    """Submitter-only: flip an analysis from `draft` → `pending`, making it
    visible to reviewers.

    Body: {"submit_with_known_issues": bool}
      · false (default) — clean submission. Timeline records "تم تقديم الطلب".
      · true            — submitter chose to submit despite AI-flagged issues.
                          Sets meta.submitted_with_known_issues=True; the
                          reviewer dashboard shows a warning badge and the
                          timeline entry says approval may be delayed.
    """
    p = _resolve_analysis_path(analysis_id)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(500, f"unreadable analysis: {exc}") from exc

    meta = dict(data.get("meta") or {})

    # Ownership: only the submitter who created this draft can submit it.
    if meta.get("submitted_by") != user["username"]:
        raise HTTPException(403, "Not authorized for this application")

    if meta.get("review_status") != "draft":
        raise HTTPException(
            400, f"Application is not a draft (current status: {meta.get('review_status')})",
        )

    submit_with_issues = bool(payload.get("submit_with_known_issues"))

    meta["review_status"] = "pending"
    meta["submitted_with_known_issues"] = submit_with_issues

    note = (
        "تم تقديم الطلب رغم وجود ملاحظات من النظام الذكي — قد يؤدي ذلك إلى "
        "تأخير عملية الموافقة."
        if submit_with_issues
        else "تم تقديم الطلب للمراجعة."
    )
    history = list(meta.get("reviewer_notes_history") or [])
    history.append({
        "timestamp": _time.strftime("%Y-%m-%dT%H:%M:%S"),
        "reviewer_username": user["username"],
        "reviewer_display": user.get("display_name") or user["username"],
        "status_before": "draft",
        "status_after": "pending",
        "note": note,
        "kind": "submission",
        "submitted_with_known_issues": submit_with_issues,
    })
    meta["reviewer_notes_history"] = history

    from datetime import datetime as _dt
    meta["updated_at"] = _dt.now().isoformat(timespec="seconds")
    data["meta"] = meta

    p.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return _summarize_analysis(data, p.stem)


@app.delete("/api/analyses/{analysis_id}")
async def delete_analysis(
    analysis_id: str,
    user: dict = Depends(require_role("reviewer")),
):
    """Reviewer-only delete. Submitters cannot withdraw once submitted."""
    p = _resolve_analysis_path(analysis_id)
    p.unlink()
    return {"deleted": analysis_id}


@app.post("/api/analyses/{analysis_id}/resubmit")
async def resubmit_analysis(
    analysis_id: str,
    file: UploadFile | None = File(None),
    pdf_deed: UploadFile | None = File(None),
    pdf_floor: UploadFile | None = File(None),
    pdf_site_plan: UploadFile | None = File(None),
    notes: str | None = Form(None),
    user: dict = Depends(require_role("submitter")),
):
    """Submitter-only partial resubmit.

    The submitter uploads ONLY the document(s) that need fixing. For every
    slot they didn't upload, we carry the previous pipeline's result forward
    untouched — no re-analysis. The new analysis JSON contains whatever was
    rerun plus the old results for unchanged slots, giving the reviewer a
    single coherent record.

    Rules:
      · Ownership: the caller's username must match meta.submitted_by
      · Status must be 'needs_revision'
      · At least ONE file must be uploaded (no-op resubmits rejected)
      · CAD rerun ⇒ agent pipeline runs (geometry + compliance)
      · Site-plan rerun ⇒ agent also reruns (compliance depends on BOTH
        the CAD geometry and the regulatory setbacks). The submitter
        doesn't have to re-upload the CAD; we use the previous CAD file
        from disk via meta.file_paths.cad.
      · Deed / floor rerun ⇒ that analyzer only; agent does not rerun.
    """
    p = _resolve_analysis_path(analysis_id)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(500, f"unreadable analysis: {exc}") from exc

    meta = dict(data.get("meta") or {})
    if meta.get("submitted_by") != user["username"]:
        raise HTTPException(403, "Not authorized for this application")
    current_status = meta.get("review_status", "pending")
    # Two valid resubmit triggers:
    #   · needs_revision — reviewer returned the app; resubmit advances it
    #                       back to `pending` so the reviewer sees it fresh.
    #   · draft         — the engineer is still in pre-submit preview and
    #                       wants to fix an AI-flagged document before
    #                       sending. The resubmission stays in `draft` so
    #                       they continue previewing.
    if current_status not in {"needs_revision", "draft"}:
        raise HTTPException(
            400,
            f"Application is '{current_status}' — only draft or needs_revision apps can be resubmitted",
        )

    uploaded = {
        "cad": file,
        "pdf_deed": pdf_deed,
        "pdf_floor": pdf_floor,
        "pdf_site_plan": pdf_site_plan,
    }
    if not any(u is not None for u in uploaded.values()):
        raise HTTPException(400, "No files uploaded — resubmit needs at least one new document")

    cfg = _load_cfg()
    upload_dir = ROOT / cfg.get("agent", {}).get("upload_dir", "uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)

    old_paths = dict(meta.get("file_paths") or {})
    # Back-compat: records predating meta.file_paths stored the CAD path at
    # the top level as `input_path`. Fall back so those old apps can still
    # resubmit without re-uploading the CAD.
    if not old_paths.get("cad") and data.get("input_path"):
        old_paths["cad"] = data["input_path"]

    # ── 1. Save any uploaded files + compute final paths per slot ─────────
    new_bytes: dict[str, bytes] = {}
    final_paths = dict(old_paths)

    if uploaded["cad"] is not None:
        b = await uploaded["cad"].read()
        dest = _unique_upload_path(upload_dir, uploaded["cad"].filename or "drawing")
        dest.write_bytes(b)
        new_bytes["cad"] = b
        final_paths["cad"] = str(dest)
        cad_filename = uploaded["cad"].filename or "drawing"
        cad_bytes = len(b)
        cad_path = str(dest)
    else:
        # Use the previous CAD file — still need the pipeline to see it.
        cad_path = old_paths.get("cad")
        if not cad_path or not Path(cad_path).exists():
            raise HTTPException(400, "Previous CAD file is missing — please upload a new CAD")
        cad_filename = meta.get("cad_filename") or Path(cad_path).name
        cad_bytes = Path(cad_path).stat().st_size

    for slot in ("pdf_deed", "pdf_floor", "pdf_site_plan"):
        up = uploaded[slot]
        if up is not None:
            b = await up.read()
            dest = _unique_upload_path(upload_dir, up.filename or f"{slot}.pdf")
            dest.write_bytes(b)
            new_bytes[slot] = b
            final_paths[slot] = str(dest)
            final_paths[f"{slot}_filename"] = up.filename or f"{slot}.pdf"

    # ── 2. Decide which pipelines re-run ─────────────────────────────────
    # Agent reruns whenever CAD or site-plan changed — compliance depends
    # on both. Deed / floor only run when their own file changed.
    rerun_agent = ("cad" in new_bytes) or ("pdf_site_plan" in new_bytes)
    rerun_deed = "pdf_deed" in new_bytes
    rerun_floor = "pdf_floor" in new_bytes
    rerun_site_plan = "pdf_site_plan" in new_bytes

    # ── 3. Build the resubmission timeline entry ─────────────────────────
    # Arabic label per slot, joined for the human-readable note.
    slot_labels = {
        "cad": "مخطط CAD",
        "pdf_deed": "سند التسجيل",
        "pdf_floor": "خطة مساحة الطابقية",
        "pdf_site_plan": "مخطط موقع تنظيمي",
    }
    replaced = [slot_labels[s] for s in ("cad", "pdf_deed", "pdf_floor", "pdf_site_plan") if s in new_bytes]
    # The post-resubmit status mirrors what the engineer was doing: a draft
    # stays a draft (continued preview); a returned application advances back
    # to pending (back into the reviewer's queue).
    next_status = "draft" if current_status == "draft" else "pending"
    note_text = (
        "تم تحديث ملفات المسودة قبل الإرسال — " + ", ".join(replaced)
        if current_status == "draft"
        else "تم رفع نسخة معدّلة من: " + ", ".join(replaced)
    )
    # Optional submitter explanation — clipped to 2000 chars to keep the
    # timeline payload bounded. Appended to the auto-generated note so the
    # reviewer sees both "what changed" (slots) and "why" (submitter's words).
    submitter_note = (notes or "").strip()
    if submitter_note:
        if len(submitter_note) > 2000:
            submitter_note = submitter_note[:2000]
        note_text = f"{note_text}\n\nملاحظات المقدّم:\n{submitter_note}"
    history = list(meta.get("reviewer_notes_history") or [])
    history.append({
        "timestamp": _time.strftime("%Y-%m-%dT%H:%M:%S"),
        "reviewer_username": user["username"],
        "reviewer_display": user.get("display_name") or user["username"],
        "status_before": current_status,
        "status_after": next_status,
        "note": note_text,
        "kind": "resubmission",
        "replaced_slots": list(new_bytes.keys()),
        "submitter_notes": submitter_note,
    })

    # ── 4. Carry forward unchanged pipeline results + reset new-pipeline flags
    new_meta = dict(meta)
    new_meta["review_status"] = next_status
    # A fixed resubmit clears any prior "submitted with known issues" warning —
    # the reviewer should treat the new version as a clean submission unless
    # the AI re-flags issues during the new pipeline run.
    new_meta["submitted_with_known_issues"] = False
    # Approval-with-open-issues is also a per-round flag — clear it so a new
    # round starts neutral.
    new_meta.pop("approved_with_open_issues", None)
    new_meta["reviewer_notes_history"] = history
    new_meta.pop("reviewer_notes", None)
    new_meta["file_paths"] = final_paths
    new_meta["cad_filename"] = cad_filename

    # Carry the previous round's missing-data state forward as a compact
    # snapshot so the new analysis's UI can:
    #   · prefill any per-row reviewer comment from the prior round when the
    #     AI re-emits the same key (so reviewer guidance survives a resubmit)
    #   · render a "✓ تم حلّ" strip for keys that disappeared this round
    # Bounded by issue count (typically <10) so no payload concern.
    prev_rows = list(data.get("missing_data") or [])
    prev_keys: list[str] = []
    prev_comments: dict[str, str] = {}
    for r in prev_rows:
        if not isinstance(r, dict):
            continue
        k = str(r.get("key") or "").strip()
        if not k:
            continue
        prev_keys.append(k)
        cmt = str(r.get("reviewer_comment") or "").strip()
        if cmt:
            prev_comments[k] = cmt[:2000]
    if prev_keys:
        new_meta["previous_round_keys"] = prev_keys
        # Snapshot of doc + issue text per key so the "resolved" strip can
        # render meaningful labels for keys that disappeared this round.
        prev_summary: dict[str, dict] = {}
        for r in prev_rows:
            if not isinstance(r, dict):
                continue
            k = str(r.get("key") or "").strip()
            if k and k not in prev_summary:
                prev_summary[k] = {
                    "document": str(r.get("document") or ""),
                    "issue":    str(r.get("issue") or ""),
                }
        new_meta["previous_round_summary"] = prev_summary
    else:
        new_meta.pop("previous_round_keys", None)
        new_meta.pop("previous_round_summary", None)
    if prev_comments:
        new_meta["previous_round_comments"] = prev_comments
    else:
        new_meta.pop("previous_round_comments", None)

    job = await store.create(
        filename=cad_filename,
        file_bytes=cad_bytes,
        input_path=cad_path,
        meta=new_meta,
    )

    # Seed the Job's per-pipeline result fields. Anything we're NOT rerunning
    # is copied from the old analysis so the finalized JSON includes it.
    if rerun_agent:
        # Agent will populate job.result when it emits `final`.
        pass
    else:
        job.result = data.get("result")

    if rerun_deed:
        job.pdf_expected = True
    else:
        job.pdf_result = data.get("pdf_result")
        job.pdf_expected = False

    if rerun_floor:
        job.floor_expected = True
    else:
        job.floor_result = data.get("floor_result")
        job.floor_expected = False

    if rerun_site_plan:
        job.site_plan_expected = True
    else:
        job.site_plan_result = data.get("site_plan_result")
        job.site_plan_expected = False

    # Preserve extras untouched — partial resubmit doesn't touch them.
    job.extras_results = list(data.get("extras_results") or [])
    job.extras_expected = 0  # already completed last cycle

    # Start the pipelines we actually need.
    if rerun_agent:
        asyncio.create_task(run_agent(job, cfg))
    else:
        # No agent run → synthesize the `done` event so the finalizer fires
        # once the (PDF-only) side pipelines land, saving the new analysis
        # JSON that carries forward the old `result`.
        asyncio.create_task(_emit_synthetic_done(job))

    if rerun_deed:
        from app.pdf_analyzer import analyze_pdf
        asyncio.create_task(analyze_pdf(job, new_bytes["pdf_deed"], cfg))

    if rerun_floor:
        from app.floor_plan_analyzer import analyze_floor_plan
        asyncio.create_task(analyze_floor_plan(job, new_bytes["pdf_floor"], cfg))

    if rerun_site_plan:
        from app.site_plan_extractor import analyze_site_plan
        asyncio.create_task(analyze_site_plan(job, new_bytes["pdf_site_plan"], cfg))

    # ── 5. Archive the prior version, then write the new stub ────────────
    # Invariant: never delete the old file before the archive copy is
    # safely on disk. If anything below this point fails the worst case
    # is a duplicate row (old + new) on the dashboard until an operator
    # cleans up — never silent data loss.
    from app.jobs import _save_stub, _analysis_path_for_job
    new_stub_path = _analysis_path_for_job(job)
    new_analysis_id = new_stub_path.stem
    old_analysis_id = p.stem

    # Tag the new job's meta with a back-pointer so the history walker
    # can chain forward → backward.
    job.meta["previous_analysis_id"] = old_analysis_id

    # Tag the OLD record with archive markers and write it into the
    # archive folder. We mutate a local copy of the data dict; the
    # original on-disk file at `p` is untouched until the unlink at the
    # end of this block.
    archived_meta = dict(data.get("meta") or {})
    archived_meta["archived_at"] = _time.strftime("%Y-%m-%dT%H:%M:%S")
    archived_meta["superseded_by"] = new_analysis_id
    archived_data = dict(data)
    archived_data["meta"] = archived_meta

    archive_dir = ANALYSIS_DIR / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / f"{old_analysis_id}.archived.json"
    archive_path.write_text(
        json.dumps(archived_data, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    # Now write the new stub. _save_stub uses the same path we computed
    # above (same `job` object, deterministic path), so the dashboard
    # picks up the new row immediately.
    stub_path = _save_stub(job)

    # Finally remove the old live file. It already lives in archive/, so
    # an unlink failure here just leaves a stale row to clean up — never
    # data loss.
    try:
        p.unlink()
    except FileNotFoundError:
        pass

    return {
        "job_id": job.id,
        "analysis_id": new_analysis_id,
        "status": "pending",
        "rerun": {
            "agent": rerun_agent,
            "deed": rerun_deed,
            "floor": rerun_floor,
            "site_plan": rerun_site_plan,
        },
        "replaced_slots": list(new_bytes.keys()),
        "previous_analysis_id": old_analysis_id,
        "message": "Resubmission accepted — analysis pipeline started",
    }


async def _emit_synthetic_done(job) -> None:
    """Fire a synthetic `done` event so `_maybe_finalize()` treats the
    (absent) CAD pipeline as complete. Used by partial resubmits that
    don't rerun the agent. Yields first to give any spawned PDF tasks a
    moment to enter their `start` phase, keeping the SSE timeline tidy."""
    await asyncio.sleep(0.05)
    await job.emit("done", synthetic=True)


@app.get("/")
async def root():
    # Entry point — auth.js on the login page gates everything client-side.
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/login")
async def login_page():
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/dashboard")
async def dashboard_page():
    return _versioned_html(STATIC_DIR / "dashboard.html")


@app.get("/overview")
async def overview_page():
    # Reviewer-only manager dashboard. Auth + role gating happen client-side
    # in shell.js (it bounces non-reviewers to /dashboard) — same shape as
    # /dashboard, which serves to both roles and renders role-aware UI.
    return _versioned_html(STATIC_DIR / "overview.html")


# ── Reviewer-only mock pages — UI demo only, dummy data lives in each
# ── corresponding *.js file. Auth/role gating happens client-side in
# ── shell.js. Backend has no /api endpoints for these yet; they're pure
# ── frontend until the actual project starts.
@app.get("/reports")
async def reports_page():
    return _versioned_html(STATIC_DIR / "reports.html")


@app.get("/timeline")
async def timeline_page():
    return _versioned_html(STATIC_DIR / "timeline.html")


@app.get("/maps")
async def maps_page():
    return _versioned_html(STATIC_DIR / "maps.html")


@app.get("/users")
async def users_page():
    return _versioned_html(STATIC_DIR / "users.html")


@app.get("/settings")
async def settings_page():
    return _versioned_html(STATIC_DIR / "settings.html")


@app.get("/app")
async def app_page():
    # The analysis view (live thinking + per-application dashboard).
    # Unified destination for both reviewers and submitters at every
    # application stage; the page renders role-aware read-only states
    # for non-draft submitter views.
    return _versioned_html(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
