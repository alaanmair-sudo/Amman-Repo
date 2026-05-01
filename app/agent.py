"""AI tool-use loop that orchestrates the setback pipeline.

Design notes:
- Manual agentic loop (not the SDK tool runner) — we need fine-grained SSE
  emission between tool calls so the UI can show live progress.
- Two prompt-cache breakpoints per request: one on the system prompt (caches
  tools + system together) and one on the last user message (caches the growing
  conversation). Prior breakpoints on earlier messages are stripped at send-time
  so we stay within the 4-breakpoint per-request limit.
- Adaptive thinking is enabled; the model chooses depth per request.
- Hard caps on turn count and total tokens prevent runaway loops.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import anthropic

from app.jobs import Job
from app.tools import TOOL_SCHEMAS, ToolExecutor
from app.validation import (
    cad_layer_issues,
    coverage_violation_row,
    cross_document_issues,
    find_missing_roles,
    geometry_error_to_row,
    setback_violation_row,
    translate_pipeline_error,
)
from dxf_native import DXFReader
from mcp_client import connect_autocad_mcp


SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "system.md"


def _flatten_exception(exc: BaseException) -> list[BaseException]:
    """Flatten BaseExceptionGroup trees (anyio TaskGroup wraps errors in these) to the leaf
    exceptions, so error messages show the underlying cause instead of a generic wrapper."""
    out: list[BaseException] = []
    stack: list[BaseException] = [exc]
    seen: set[int] = set()
    while stack:
        e = stack.pop()
        if id(e) in seen:
            continue
        seen.add(id(e))
        group_excs = getattr(e, "exceptions", None)
        if isinstance(group_excs, (list, tuple)) and group_excs:
            stack.extend(group_excs)
        else:
            out.append(e)
        cause = e.__cause__ or e.__context__
        if cause is not None and id(cause) not in seen:
            stack.append(cause)
    return out


def _load_system() -> str:
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def _strip_cache_control(messages: list[dict]) -> list[dict]:
    """Return a copy of messages with cache_control removed from all content blocks."""
    out = []
    for m in messages:
        if not isinstance(m.get("content"), list):
            out.append(m)
            continue
        new_content = []
        for block in m["content"]:
            if isinstance(block, dict) and "cache_control" in block:
                block = {k: v for k, v in block.items() if k != "cache_control"}
            new_content.append(block)
        out.append({**m, "content": new_content})
    return out


def _mark_last_user_cache(messages: list[dict]) -> list[dict]:
    """Add cache_control: ephemeral to the last content block of the last user message."""
    if not messages:
        return messages
    out = _strip_cache_control(messages)
    for i in range(len(out) - 1, -1, -1):
        if out[i]["role"] == "user":
            content = out[i]["content"]
            if isinstance(content, list) and content:
                last = content[-1]
                if isinstance(last, dict):
                    content[-1] = {**last, "cache_control": {"type": "ephemeral"}}
            break
    return out


def _summarize_tool_result(result: Any) -> str:
    """Short human-readable summary of a tool result for SSE events (not sent to Claude)."""
    if not isinstance(result, dict):
        return str(result)[:200]
    if "error" in result:
        return f"error: {result['error']}"
    keys = [f"{k}={result[k]}" for k in ("handle", "count", "entity_count", "edge_count", "opened", "bytes", "layer") if k in result]
    if "layers" in result and isinstance(result["layers"], list):
        keys.append(f"{len(result['layers'])} layers")
    return " | ".join(keys) or "ok"


def _sanitize_tool_result_for_ui(result: Any) -> Any:
    """Strip non-JSON-serializable or internal fields from a tool result for the live-thinking pane."""
    if not isinstance(result, dict):
        return None
    import json as _json
    out: dict = {}
    for k, v in result.items():
        if k == "handle":  # opaque scratchpad handle — not useful to the user
            continue
        try:
            _json.dumps(v)
            out[k] = v
        except (TypeError, ValueError):
            pass
    return out or None


async def _emit_compliance_violations(job: Job) -> None:
    """After the CAD pipeline finalizes, compare actual KPIs against the
    limits from the regulatory site plan and surface any violations as
    missing-data rows on the review panel. Called exactly once per run,
    right after `final` is emitted.

    Silent no-op when the required data isn't available (e.g. the site plan
    pipeline failed — its own `missing_data` row already explains why
    compliance couldn't be checked)."""
    result = job.result or {}
    sp = job.site_plan_result or {}
    if sp.get("status") != "ok":
        return

    # Coverage: actual building÷lot vs. allowed نسبة التغطية from the PDF.
    # Small epsilon prevents 33.00001 vs. 33 noise from firing the rule.
    actual_cov = result.get("coverage_pct")
    allowed_cov = sp.get("coverage_pct")
    if (
        isinstance(actual_cov, (int, float))
        and isinstance(allowed_cov, (int, float))
        and float(actual_cov) > float(allowed_cov) + 0.05
    ):
        await job.record_missing_data(
            coverage_violation_row(float(actual_cov), float(allowed_cov))
        )

    # Setback violations: anything in the compliance result's violation area.
    compliance = result.get("compliance") or {}
    va = compliance.get("total_violation_area_m2")
    if isinstance(va, (int, float)) and float(va) > 0.01:
        await job.record_missing_data(
            setback_violation_row(
                float(va),
                fine_jd=compliance.get("fine_jd"),
                is_serious=bool(compliance.get("is_serious")),
            )
        )


async def run_agent(job: Job, cfg: dict) -> None:
    agent_cfg = cfg.get("agent", {})
    mcp_cfg = cfg.get("autocad_mcp", {})

    api_key = os.environ.get(agent_cfg.get("api_key_env", "ANTHROPIC_API_KEY"))
    if not api_key:
        job.error = f"{agent_cfg.get('api_key_env', 'ANTHROPIC_API_KEY')} env var is not set."
        job.status = "error"
        await job.emit("error", message=job.error)
        await job.emit("done")
        return

    client = anthropic.AsyncAnthropic(api_key=api_key)
    model = agent_cfg.get("model", "claude-sonnet-4-6")
    max_tokens = int(agent_cfg.get("max_tokens", 8192))
    max_turns = int(agent_cfg.get("max_turns", 25))
    max_total_tokens = int(agent_cfg.get("max_total_tokens", 200000))

    system_blocks = [
        {"type": "text", "text": _load_system(), "cache_control": {"type": "ephemeral"}}
    ]

    total_in = 0
    total_out = 0
    job.status = "running"
    # Emit agent_start IMMEDIATELY so the loading screen reflects the real
    # start. The previous flow blocked on a polling wait for the site-plan
    # extractor before this emit, which delayed the bar by 5-30s of dead
    # time. The site-plan wait is now deferred to _run_loop (after preflight),
    # by which time most of the extraction has run in parallel anyway.
    await job.emit("agent_start", model=model)

    input_ext = Path(job.input_path).suffix.lower()
    use_native_dxf = input_ext == ".dxf"

    async def _build_site_plan_message_line() -> str:
        """Resolve the regulatory site-plan instruction line for the initial
        user message. Called from `_run_loop` AFTER preflight, so any wait
        here overlaps with — and is mostly absorbed by — the time we already
        spent opening the drawing and listing layers.

        Two paths into "we have a site plan":
          · Fresh upload — job.site_plan_expected=True, the extractor task
            is running in parallel; we wait up to N seconds for it to finish.
          · Partial resubmit (CAD-only rerun) — job.site_plan_expected=False
            but job.site_plan_result was pre-seeded from the previous
            analysis by the resubmit endpoint. Use it directly without waiting.
        """
        sp = job.site_plan_result
        if sp is None and job.site_plan_expected:
            wait_deadline = time.monotonic() + float(
                agent_cfg.get("site_plan_wait_seconds", 60.0)
            )
            while job.site_plan_result is None and time.monotonic() < wait_deadline:
                await asyncio.sleep(0.25)
            sp = job.site_plan_result

        # Wording must match the strings the system prompt told the agent to
        # look for ("Site plan: missing" / "Site plan: unreadable") so the
        # gating rule in the prompt fires reliably.
        if sp is not None:
            if sp.get("status") == "ok":
                front = sp["front_setback_m"]
                side = sp["side_setback_m"]
                rear = sp.get("rear_setback_m")
                corner = bool(sp.get("is_corner_lot"))
                rear_str = f"{rear}" if rear is not None else "null"
                return (
                    f"Site plan setbacks: front={front}, side={side}, rear={rear_str}, "
                    f"is_corner_lot={str(corner).lower()}. After computing geometry, "
                    "look for a STREET layer (case-insensitive), call extract_street_polylines "
                    "if present, then call compute_compliance with these values."
                )
            if sp.get("status") == "wrong_document":
                return (
                    f"Site plan: wrong document — {sp.get('reason', 'unknown')}. "
                    "Skip compliance flow and pass compliance_unavailable=that reason to finalize."
                )
            if sp.get("status") == "extraction_failed":
                return (
                    f"Site plan: unreadable — {sp.get('reason', 'extraction failed')}. "
                    "Skip compliance flow and pass compliance_unavailable=that reason to finalize."
                )
            return (
                f"Site plan: error — {sp.get('error', 'unknown')}. "
                "Skip compliance flow and pass compliance_unavailable=that reason to finalize."
            )
        if job.site_plan_expected:
            # Was expected, never landed within the timeout.
            return (
                "Site plan: still extracting after timeout — skip compliance flow "
                "and pass compliance_unavailable='site plan extraction timed out' to finalize."
            )
        return (
            "Site plan: missing — skip the compliance flow and pass "
            "compliance_unavailable='site plan missing' to finalize."
        )

    async def _run_loop(backend, layer_names: list[str], gate_task: asyncio.Task | None = None):
        nonlocal total_in, total_out
        executor = ToolExecutor(job, backend, cfg)
        await job.emit("mcp_ready", backend=("ezdxf" if use_native_dxf else "autocad"))

        # Build the initial user message NOW — preflight already opened the
        # drawing and listed layers, and the side pipelines (deed / floor /
        # site-plan) ran in parallel during that work. Resolving the
        # site-plan instruction line here is mostly a no-op wait now.
        site_plan_message_line = await _build_site_plan_message_line()
        # Telling the agent the drawing is already open and giving it the
        # exact layer list lets it skip three early tool calls
        # (convert_dwf_if_needed, open_drawing, list_layers) — saving ~6s
        # per run on the AutoCAD path. The tools remain idempotent if the
        # model still calls them.
        layers_line = (
            f"Drawing already opened by preflight. Layers detected ({len(layer_names)}): "
            f"{', '.join(layer_names) if layer_names else '(none)'}."
        )
        initial_user = (
            f"A user uploaded `{job.filename}` ({job.file_bytes} bytes). "
            "Compute building-to-lot setbacks per the instructions.\n\n"
            f"{layers_line}\n"
            "Skip `convert_dwf_if_needed`, `open_drawing` and `list_layers` "
            "and start with `extract_polylines` directly.\n\n"
            f"{site_plan_message_line}"
        )
        messages: list[dict] = [{"role": "user", "content": initial_user}]

        for turn in range(max_turns):
            # Cross-doc identity gate runs concurrently with this loop.
            # Check between turns: if it has finished AND returned False
            # (blocking mismatch), bail out with `analysis_blocked` before
            # spending another model call on geometry that's about to be
            # discarded. job.result is None means the agent hasn't yet
            # called finalize, so the bail is still meaningful.
            if (gate_task is not None and gate_task.done()
                    and job.result is None):
                try:
                    gate_ok = gate_task.result()
                except Exception:
                    gate_ok = True   # fail-open if the gate itself crashed
                if not gate_ok:
                    await _emit_analysis_blocked("deed_site_plan_identity_mismatch")
                    return

            request_messages = _mark_last_user_cache(messages)
            await job.emit("turn_start", turn=turn + 1)

            async with client.messages.stream(
                model=model,
                max_tokens=max_tokens,
                system=system_blocks,
                tools=TOOL_SCHEMAS,
                messages=request_messages,
                thinking={"type": "adaptive"},
            ) as stream:
                async for text_delta in stream.text_stream:
                    await job.emit("assistant_text", delta=text_delta)
                response = await stream.get_final_message()

            total_in += response.usage.input_tokens
            total_out += response.usage.output_tokens
            await job.emit(
                "turn_usage",
                turn=turn + 1,
                stop_reason=response.stop_reason,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                cache_read=getattr(response.usage, "cache_read_input_tokens", 0),
                cache_write=getattr(response.usage, "cache_creation_input_tokens", 0),
            )

            if total_in + total_out > max_total_tokens:
                raise RuntimeError(
                    f"Token budget exceeded ({total_in + total_out} > {max_total_tokens})"
                )

            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn":
                break
            if response.stop_reason == "pause_turn":
                continue

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                break

            # Run all tool_uses in this turn concurrently. The model never
            # passes a handle from one tool in this batch as an input to
            # another tool in the same batch (handles are returned in the
            # tool_result and only referenced on the next turn), so it is
            # safe to fan out. Order is preserved in tool_results so the
            # request → response binding by tool_use_id stays unambiguous.
            async def _run_one(tu):
                # Pass `id=tu.id` so the frontend can match tool_end events
                # back to their tool_start cards even when multiple tools
                # run in parallel within a single turn (e.g. extract_polylines
                # for building + lot). Without this, two simultaneous tools
                # with the same name leave one card stuck in "running" because
                # the single shared pendingToolCard slot gets overwritten.
                await job.emit("tool_start", id=tu.id, name=tu.name, input=tu.input)
                result = await executor.run(tu.name, tu.input)
                await job.emit(
                    "tool_end",
                    id=tu.id,
                    name=tu.name,
                    summary=_summarize_tool_result(result),
                    details=_sanitize_tool_result_for_ui(result),
                )
                return result

            results = await asyncio.gather(*[_run_one(tu) for tu in tool_uses])
            tool_results = [
                {
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": str(result),
                    "is_error": isinstance(result, dict) and "error" in result,
                }
                for tu, result in zip(tool_uses, results)
            ]

            messages.append({"role": "user", "content": tool_results})

            if job.result is not None:
                break

        if job.result is None:
            raise RuntimeError("Agent ended without calling finalize")

        await job.emit("final", **job.result)
        await _emit_compliance_violations(job)
        job.status = "done"

    async def _preflight_and_check_layers(backend) -> tuple[bool, list[str]]:
        """Open the drawing, list its layers, and record `missing_data` rows
        for any required layer missing from the allowlist (building/lot/street).

        Returns (ok, layer_names). `ok` is True only when ALL THREE required
        layers are present — building, lot, AND street. Any missing layer
        halts the pipeline pre-agent and bounces the submitter back to upload
        (per the early-gate policy: the analysis can't compute setbacks/
        coverage without all three). `layer_names` is the full layer list so
        the agent's initial user message can include it and skip its own
        list_layers/open_drawing calls. The caller emits `analysis_blocked`
        and lets the side pipelines (deed, floor, site-plan) finish so their
        own results are still persisted.
        """
        input_path = Path(job.input_path)
        suffix = input_path.suffix.lower()
        dwg_path = str(input_path)

        # DWF needs conversion to DWG before AutoCAD can read it. We do the
        # conversion once here and cache the path in scratchpad so the agent
        # tool (_convert_dwf_if_needed) reuses it instead of re-converting.
        if suffix in {".dwf", ".dwfx"}:
            from dwf_convert import normalize_to_dwg
            dwf_cfg = cfg.get("dwf_converter", {})
            dwg_p, tmp_dir = normalize_to_dwg(
                input_path,
                converter_cmd=dwf_cfg.get("command", "dwgConvert"),
                converter_args=dwf_cfg.get("args", []),
                timeout_seconds=int(dwf_cfg.get("timeout_seconds", 120)),
            )
            dwg_path = str(dwg_p)
            job.scratchpad["_dwg_path"] = dwg_path
            job.scratchpad["_tmp_dir"] = str(tmp_dir) if tmp_dir else None

        # AutoCAD 2027 vanilla bug: vla-open silently falls back to typing
        # the path on the command line when it contains spaces, which then
        # tokenizes on whitespace ("CAD repository github" splits, etc.)
        # and the open quietly fails — the dispatcher then reads layers
        # from the previously-active doc (Drawing1.dwg with only 0/Defpoints)
        # so the validator (correctly) reports BUILDING/LOT/STREET missing.
        # Copy the file to a no-spaces temp path before sending to the
        # MCP. Skipped for the native DXF path because DXFReader is pure
        # Python and unaffected.
        if not use_native_dxf:
            import shutil
            safe_dir = Path("C:/temp/mcp_open")
            safe_dir.mkdir(parents=True, exist_ok=True)
            safe_path = safe_dir / f"{job.id}.dwg"
            shutil.copy2(dwg_path, safe_path)
            dwg_path = str(safe_path)
            job.scratchpad["_dwg_path"] = dwg_path
            job.scratchpad["_safe_open_path"] = dwg_path

        await backend.open_drawing(dwg_path)
        layers = await backend.list_layers() or []
        names = [l.get("name") if isinstance(l, dict) else str(l) for l in layers]

        for row in cad_layer_issues(names):
            await job.record_missing_data(row)

        # Block the agent unless every required role has a matching layer.
        return (len(find_missing_roles(names)) == 0, names)

    async def _early_cross_doc_gate() -> bool:
        """Wait (bounded) for the deed + site-plan extractions to land, then
        run the categorical identity checks (plot / basin / village) so we
        can halt the agent BEFORE the heavy loop when the two documents
        describe different lots. Returns True if no blocking mismatch was
        found (or the inputs aren't available within the wait window — we
        fall through to the existing post-analysis cross-doc check in that
        case). Returns False when at least one blocking row was emitted."""
        # Both pipelines are spawned in parallel with this agent task; they
        # populate job.pdf_result / job.site_plan_result when done. If a
        # pipeline isn't expected (partial resubmit that pre-seeds results),
        # we treat the existing pre-seeded value as ready immediately.
        if not (job.pdf_expected or job.pdf_result is not None):
            return True
        if not (job.site_plan_expected or job.site_plan_result is not None):
            return True

        wait_seconds = float(agent_cfg.get("early_gate_wait_seconds", 60.0))
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            if job.pdf_result is not None and job.site_plan_result is not None:
                break
            await asyncio.sleep(0.25)

        # If either side didn't land in time, skip the early gate — the
        # post-analysis cross-doc check still runs in _maybe_finalize, so
        # nothing is lost; we just couldn't bail early.
        if job.pdf_result is None or job.site_plan_result is None:
            return True

        # Site plan must have parsed cleanly for identity comparison to be
        # meaningful. wrong_document / extraction_failed paths produce their
        # own dedicated missing_data rows already.
        if job.site_plan_result.get("status") != "ok":
            return True

        rows = cross_document_issues(
            pdf_result=job.pdf_result,
            cad_result=None,         # CAD geometry not needed (and not run yet)
            floor_result=None,       # floor checks belong post-analysis
            site_plan_result=job.site_plan_result,
        )
        blocking_rows = [r for r in rows if r.get("blocking")]
        for row in blocking_rows:
            await job.record_missing_data(row)
        return len(blocking_rows) == 0

    async def _emit_analysis_blocked(reason: str) -> None:
        """Halt the agent and surface a focused 'fix before analysis' state
        to the frontend. The submitter sees only the blocking rows + the
        existing edit-files CTA; the heavy chart/KPIs are hidden because
        we have nothing meaningful to show without a successful run."""
        blocking_keys = [r.get("key") for r in job.missing_data if r.get("blocking")]
        # Persist on meta so a reload of the analysis still presents the
        # blocked state — the frontend reads meta.blocking_issues_present
        # alongside the missing_data array on auto-load.
        job.meta["blocking_issues_present"] = True
        job.meta["blocked_reason"] = reason
        await job.emit(
            "analysis_blocked",
            reason=reason,
            blocking_keys=blocking_keys,
        )
        job.status = "done"

    async def _run_with_backend(backend) -> None:
        """Single shared sequence whether the backend is the native DXF
        reader or the AutoCAD MCP bridge.

        Two early gates protect the agent loop:
          1. Layer preflight — must pass before mcp_ready / agent loop;
             any missing required layer is a hard halt because we can't
             compute geometry without them.
          2. Cross-document identity (deed ↔ site-plan plot/basin/village) —
             previously serial and blocking; now runs as a background task
             concurrently with the agent loop. The agent loop checks the
             task between turns and bails out with `analysis_blocked` if
             it returned False. Saves ~8-10s on every successful run by
             not waiting for `pdf_done` before emitting `mcp_ready`. On
             the rare mismatched run we waste at most one or two agent
             turns (~3-6s) before the check fires."""
        ok, layer_names = await _preflight_and_check_layers(backend)
        if not ok:
            await _emit_analysis_blocked("cad_missing_required_layers")
            return
        gate_task = asyncio.create_task(_early_cross_doc_gate())
        try:
            await _run_loop(backend, layer_names, gate_task)
        finally:
            # Cancel the gate task if the agent finished before it did
            # (typical fast-path) or if an exception bubbled out. Failures
            # to cancel cleanly are non-fatal — the worst case is the gate
            # adds a missing_data row after the analysis is already saved,
            # which dedups against rows the post-finalize check would have
            # added anyway.
            if not gate_task.done():
                gate_task.cancel()
                try:
                    await gate_task
                except (asyncio.CancelledError, Exception):
                    pass

    try:
        if use_native_dxf:
            backend = DXFReader(path=Path(job.input_path))
            await _run_with_backend(backend)
        else:
            async with connect_autocad_mcp(
                repo_dir=mcp_cfg.get("repo_dir", "autocad-mcp"),
                python_exe=mcp_cfg.get("python_exe", "autocad-mcp/.venv/Scripts/python.exe"),
                backend=mcp_cfg.get("backend", "file_ipc"),
                ipc_timeout=str(mcp_cfg.get("ipc_timeout", "60")),
            ) as mcp:
                await _run_with_backend(mcp)

    except BaseException as e:
        leaves = _flatten_exception(e)
        traceback.print_exc(file=sys.stderr)
        for leaf in leaves:
            print("  cause:", type(leaf).__name__, str(leaf)[:500], file=sys.stderr)

        # Classify each leaf: content issues (known geometry ValueErrors)
        # become `missing_data` rows on the review panel; the rest are real
        # system failures that still fire the generic error banner.
        missing_rows: list[dict] = []
        unknown_leaves: list[BaseException] = []
        for leaf in leaves:
            row = geometry_error_to_row(f"{type(leaf).__name__}: {leaf}")
            if row is not None:
                missing_rows.append(row)
            else:
                unknown_leaves.append(leaf)

        for row in missing_rows:
            await job.record_missing_data(row)

        if unknown_leaves:
            details_en = " | ".join(f"{type(x).__name__}: {x}" for x in unknown_leaves)
            details_ar = " | ".join(
                translate_pipeline_error(f"{type(x).__name__}: {x}") for x in unknown_leaves
            ) or translate_pipeline_error(details_en)
            job.error = details_ar
            job.status = "error"
            await job.emit("error", message=details_ar)
        elif missing_rows:
            # All failures were content issues surfaced on the review panel.
            # The application is not in a hard error state — the reviewer
            # will see the table and mark it needs_revision.
            job.status = "done"
            await job.emit("agent_skipped", reason="geometry_content_issues")
    finally:
        tmp_dir = job.scratchpad.get("_tmp_dir")
        if tmp_dir:
            import shutil

            shutil.rmtree(tmp_dir, ignore_errors=True)
        # Best-effort cleanup of the no-spaces copy we made for the
        # AutoCAD 2027 vla-open workaround. Failure is non-fatal — at
        # worst we leak a single .dwg until the next job for the same
        # id (job ids are unique, so no risk of stomping a live file).
        safe_path = job.scratchpad.get("_safe_open_path")
        if safe_path:
            try:
                Path(safe_path).unlink(missing_ok=True)
            except OSError:
                pass
        await job.emit("done", total_input_tokens=total_in, total_output_tokens=total_out)
