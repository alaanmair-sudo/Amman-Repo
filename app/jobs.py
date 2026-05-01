"""Per-job state: event queue (for SSE), scratchpad (handle → object), final result.

Each job also persists itself to `analysis/{name}_{YYYY-MM-DD}_{HHMMSS}.json` once
all expected pipelines (CAD agent, deed PDF, floor-plan PDF) have terminated.
The saved record contains both the UI-visible outputs (final results, plus the
full SSE event stream the frontend received) and backend tool details, so a
prior run can be reviewed or debugged without re-running it.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any


_ANALYSIS_DIR = Path(__file__).resolve().parent.parent / "analysis"
_TERMINAL_EVENTS = {
    "done",
    "pdf_done", "pdf_error",
    "floor_done", "floor_error",
    "extra_done", "extra_error",
    "site_plan_done", "site_plan_error",
}
_FNAME_SANITIZE_RE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class Job:
    id: str
    filename: str
    file_bytes: int
    input_path: str
    status: str = "pending"
    events: asyncio.Queue = field(default_factory=asyncio.Queue)
    scratchpad: dict[str, Any] = field(default_factory=dict)
    result: dict | None = None
    error: str | None = None
    # PDF subsystem — fully independent of the CAD pipeline above.
    pdf_expected: bool = False
    pdf_result: dict | None = None
    # Floor-plan-area subsystem — also fully independent of CAD.
    floor_expected: bool = False
    floor_result: dict | None = None
    # Regulatory site-plan subsystem ("مخطط موقع تنظيمي") — extracts the
    # required setbacks (front/side/rear) so the CAD agent can compute
    # violation area + fine. Independent task; CAD agent reads
    # `site_plan_result` if present once the extractor finishes.
    site_plan_expected: bool = False
    site_plan_result: dict | None = None
    # Additional PDFs — uploaded in the same flow as the deed. Each one is
    # extracted independently via its own `analyze_extra_pdf` task. The list
    # is pre-allocated at intake with {"filename", "status": "pending"} slots
    # so events can reference rows by index.
    extras_expected: int = 0
    extras_results: list[dict] = field(default_factory=list)
    # Application-level metadata (type, review status, notes) set at intake
    # and updated from the dashboard.
    meta: dict = field(default_factory=dict)
    # Missing-data rows surfaced to the reviewer as a "needs-revision"
    # checklist. Appended via `record_missing_data()`; each entry is a dict
    # {key, document, issue, action} where `key` is a stable identifier so
    # repeat detections (preflight + geometry) dedupe instead of stacking.
    missing_data: list[dict] = field(default_factory=list)
    # Persistence: full SSE feed + finalize bookkeeping.
    events_log: list[dict] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    saved_path: str | None = None
    _finalized: bool = False

    async def emit(self, kind: str, **payload: Any) -> None:
        event = {"kind": kind, **payload}
        self.events_log.append({"ts": time.time(), **event})
        await self.events.put(event)
        if kind in _TERMINAL_EVENTS:
            self._maybe_finalize()

    def emit_nowait(self, kind: str, **payload: Any) -> None:
        event = {"kind": kind, **payload}
        self.events_log.append({"ts": time.time(), **event})
        self.events.put_nowait(event)
        if kind in _TERMINAL_EVENTS:
            self._maybe_finalize()

    async def record_missing_data(self, row: dict) -> None:
        """Append a missing-data row (with de-dup by `key`) and emit an SSE
        event so the frontend can render it live in the review panel.
        Blocking rows (severe issues that halt the analysis pre-agent —
        missing CAD layers, deed↔site-plan identity mismatches) carry an
        extra `blocking=True` flag the frontend uses to switch into the
        focused "fix before analysis" view."""
        if not isinstance(row, dict):
            return
        key = row.get("key")
        if key and any(r.get("key") == key for r in self.missing_data):
            return
        entry = {
            "key": key or "",
            "document": row.get("document", ""),
            "issue": row.get("issue", ""),
            "action": row.get("action", ""),
        }
        if row.get("blocking"):
            entry["blocking"] = True
        self.missing_data.append(entry)
        await self.emit("missing_data", **entry)

    def store(self, key: str, value: Any) -> str:
        """Store an object in the scratchpad and return an opaque handle."""
        handle = f"{key}_{uuid.uuid4().hex[:6]}"
        self.scratchpad[handle] = value
        return handle

    def fetch(self, handle: str) -> Any:
        if handle not in self.scratchpad:
            raise KeyError(f"Unknown handle: {handle}")
        return self.scratchpad[handle]

    def _run_cross_document_checks(self) -> None:
        """Cross-validate values that span pipelines (deed lot vs CAD lot,
        deed identifiers vs site-plan identifiers, num_floors vs site-plan
        max, floor ratio vs allowed). Discrepancies are appended to
        `self.missing_data` and emitted as `missing_data` SSE events so the
        live stream + the persisted record both pick them up."""
        from app.validation import cross_document_issues
        rows = cross_document_issues(
            pdf_result=self.pdf_result,
            cad_result=self.result,
            floor_result=self.floor_result,
            site_plan_result=self.site_plan_result,
        )
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = row.get("key") or ""
            # Same dedup contract as record_missing_data — never double-add
            # a row that some upstream stage already emitted.
            if key and any(r.get("key") == key for r in self.missing_data):
                continue
            entry = {
                "key": key,
                "document": row.get("document", ""),
                "issue": row.get("issue", ""),
                "action": row.get("action", ""),
            }
            if row.get("blocking"):
                entry["blocking"] = True
            self.missing_data.append(entry)
            try:
                self.emit_nowait("missing_data", **entry)
            except Exception:
                traceback.print_exc()

    def _maybe_finalize(self) -> None:
        if self._finalized:
            return
        kinds = {e["kind"] for e in self.events_log}
        cad_done = "done" in kinds
        pdf_done = (not self.pdf_expected) or bool(kinds & {"pdf_done", "pdf_error"})
        floor_done = (not self.floor_expected) or bool(kinds & {"floor_done", "floor_error"})
        site_plan_done = (
            (not self.site_plan_expected)
            or bool(kinds & {"site_plan_done", "site_plan_error"})
        )
        extras_done = (
            self.extras_expected == 0
            or all(r.get("status") in ("done", "error") for r in self.extras_results)
        )
        if cad_done and pdf_done and floor_done and site_plan_done and extras_done:
            self._finalized = True
            # Cross-document discrepancy checks run AFTER every pipeline has
            # committed its result but BEFORE we serialize, so the new rows
            # are persisted on the analysis JSON in the same write.
            try:
                self._run_cross_document_checks()
            except Exception:
                traceback.print_exc()
            try:
                self.saved_path = _save_analysis(self)
            except Exception as exc:
                traceback.print_exc()
                # Persisting the final record failed (disk full, permission,
                # transient lock, etc.). Without surfacing this the job stays
                # on status="running" forever and the dashboard row gets
                # stuck on "قيد التحليل". Flip in-memory status, emit the
                # error on the live SSE stream, and retry the save once with
                # status="error" so the dashboard reflects reality.
                self.status = "error"
                if not self.error:
                    self.error = f"Failed to persist analysis results: {exc}"
                try:
                    self.emit_nowait("error", message=self.error)
                except Exception:
                    traceback.print_exc()
                try:
                    self.saved_path = _save_analysis(self)
                except Exception:
                    traceback.print_exc()


def _sanitize_name(name: str) -> str:
    """Make a filesystem-safe slug from a filename (stem only)."""
    stem = Path(name).stem or "job"
    return _FNAME_SANITIZE_RE.sub("-", stem).strip("-") or "job"


def _analysis_path_for_job(job: Job) -> Path:
    """Deterministic path for a job's analysis JSON. Both `_save_stub()`
    (called at intake so the dashboard shows the row immediately) and
    `_save_analysis()` (called by the finalizer when the pipeline ends)
    target the same file — the final write overwrites the stub in place,
    which keeps the analysis id stable for the submitter + reviewer
    across the whole lifecycle."""
    _ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
    name_stem = "pdf-only" if job.filename == "(no CAD)" else _sanitize_name(job.filename)
    ts = datetime.fromtimestamp(job.created_at).strftime("%Y-%m-%d_%H%M%S")
    return _ANALYSIS_DIR / f"{name_stem}_{ts}_{job.id}.json"


def _save_stub(job: Job) -> str:
    """Write a minimal analysis record at intake so the submitter's
    dashboard surfaces the new row immediately as `status=running` —
    'قيد التحليل'. The finalizer's _save_analysis() overwrites this with
    full pipeline results when every stage completes.

    For partial-resubmit stubs, the resubmit endpoint pre-seeds carried-
    over results onto job.* (job.result, job.pdf_result, etc.) so the
    submitter doesn't lose visibility of analyses that aren't re-running.
    We persist those into the stub so a refresh-during-pipeline still
    shows the carried-over data instead of an empty shell."""
    out_path = _analysis_path_for_job(job)
    record = {
        "job_id": job.id,
        "filename": job.filename,
        "file_bytes": job.file_bytes,
        "input_path": job.input_path,
        "status": "running",
        "error": None,
        "created_at": datetime.fromtimestamp(job.created_at).isoformat(timespec="seconds"),
        "finished_at": None,
        # Carried-over results survive on the stub. For fresh uploads these
        # fields are still None on the Job; for resubmits they hold the
        # previous pipeline's output for slots that aren't being re-run.
        "result": getattr(job, "result", None),
        "pdf_expected": job.pdf_expected,
        "pdf_result": getattr(job, "pdf_result", None),
        "floor_expected": job.floor_expected,
        "floor_result": getattr(job, "floor_result", None),
        "site_plan_expected": job.site_plan_expected,
        "site_plan_result": getattr(job, "site_plan_result", None),
        "extras_expected": job.extras_expected,
        "extras_results": list(job.extras_results or []),
        "meta": dict(job.meta or {}),
        "missing_data": [],
        "events": [],
    }
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2, default=str)
    job.saved_path = str(out_path)
    return str(out_path)


def _save_analysis(job: Job) -> str:
    """Persist the full job record (UI events + backend results) to analysis/.
    Uses `_analysis_path_for_job()` so stub and final writes collide on the
    same file, keeping a single source of truth per application."""
    out_path = _analysis_path_for_job(job)

    record = {
        "job_id": job.id,
        "filename": job.filename,
        "file_bytes": job.file_bytes,
        "input_path": job.input_path,
        "status": job.status,
        "error": job.error,
        "created_at": datetime.fromtimestamp(job.created_at).isoformat(timespec="seconds"),
        "finished_at": datetime.fromtimestamp(time.time()).isoformat(timespec="seconds"),
        "result": job.result,
        "pdf_expected": job.pdf_expected,
        "pdf_result": job.pdf_result,
        "floor_expected": job.floor_expected,
        "floor_result": job.floor_result,
        "site_plan_expected": job.site_plan_expected,
        "site_plan_result": job.site_plan_result,
        "extras_expected": job.extras_expected,
        "extras_results": job.extras_results,
        "meta": job.meta or {},
        "missing_data": list(job.missing_data or []),
        "events": job.events_log,
    }

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2, default=str)

    return str(out_path)


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = asyncio.Lock()

    async def create(self, filename: str, file_bytes: int, input_path: str, meta: dict | None = None) -> Job:
        async with self._lock:
            job_id = uuid.uuid4().hex[:12]
            job = Job(
                id=job_id,
                filename=filename,
                file_bytes=file_bytes,
                input_path=input_path,
                meta=dict(meta or {}),
            )
            self._jobs[job_id] = job
            return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)


store = JobStore()
