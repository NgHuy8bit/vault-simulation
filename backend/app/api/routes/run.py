from __future__ import annotations

import asyncio
import json
import os
import platform
import re
import shlex
import shutil
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.paths import safe_resolve
from app.core.settings_store import get_run_settings, get_spec_base, get_smart_contracts_dir

router = APIRouter(prefix="/api", tags=["run"])

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# ── Live "where are we" progress parsing ─────────────────────────────────────
# Gauge's verbose console reporter (--verbose) prints a line per spec heading,
# scenario heading and step as they execute, e.g.:
#   # Loan Partial Early Principal Repayment Validation Test
#     ## Reject partial early repayment when amount is below minimum (...)
#       * Set events time zone "Asia/Ho_Chi_Minh".  ✔
# We classify each streamed line into spec/scenario/step so the UI can show a
# live "Spec › Scenario › Step" breadcrumb instead of an opaque wall of text.
_TICK_RE = re.compile(r"[✔✓]")
_CROSS_RE = re.compile(r"[✗✘×]")
_SPEC_LINE_RE = re.compile(r"^#\s+(?P<text>\S.*)$")
_SCENARIO_LINE_RE = re.compile(r"^\s*##\s+(?P<text>\S.*)$")
_STEP_LINE_RE = re.compile(r"^\s*\*\s+(?P<text>\S.*)$")


def _classify_progress_line(line: str) -> Optional[dict]:
    """Best-effort classification of a streamed gauge console line.

    Returns {'level': 'spec'|'scenario'|'step', 'text': ..., 'status': ...}
    or None if the line isn't a heading/step line. This is purely informational
    (drives a "currently running" breadcrumb) — if gauge changes its console
    format this just stops updating, it never breaks the raw log stream.
    """
    stripped = line.rstrip("\n")
    if not stripped.strip():
        return None

    def _status_from(text: str) -> str:
        if _CROSS_RE.search(text):
            return "failed"
        if _TICK_RE.search(text):
            return "passed"
        return "running"

    m = _STEP_LINE_RE.match(stripped)
    if m:
        text = _CROSS_RE.sub("", _TICK_RE.sub("", m.group("text"))).strip()
        return {"level": "step", "text": text, "status": _status_from(stripped)}

    m = _SCENARIO_LINE_RE.match(stripped)
    if m:
        text = _CROSS_RE.sub("", _TICK_RE.sub("", m.group("text"))).strip()
        return {"level": "scenario", "text": text, "status": "running"}

    m = _SPEC_LINE_RE.match(stripped)
    if m:
        return {"level": "spec", "text": m.group("text").strip(), "status": "running"}

    return None


def _load_json_report(smart_contracts_dir) -> Optional[dict]:
    """Read & compact the json-report gauge produces after each run.

    Returns a tree: spec -> scenarios -> steps, with status + error/stacktrace
    only on failed steps (keeps the payload small). Returns None if the report
    can't be found/parsed — the raw log remains the source of truth either way.
    """
    report_path = smart_contracts_dir / ".gauge" / "reports" / "json-report" / "result.json"
    try:
        with open(report_path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None

    specs = []
    for spec_result in raw.get("specResults", []):
        scenarios = []
        for scenario in spec_result.get("scenarios", []):
            steps = []
            for item in scenario.get("items", []):
                if item.get("itemType") != "step":
                    continue
                res = item.get("result") or {}
                status = res.get("status", "notExecuted")
                # `span.start` is the 1-based line number of this step in the
                # .spec file — gauge includes it in the json-report and it maps
                # 1:1 to the `line` field the spec_parser stores per step.
                span = item.get("span") or {}
                step = {
                    "text": item.get("stepText", ""),
                    "status": status,
                    "line": span.get("start"),   # 1-based spec line, or None
                }
                if status == "failed":
                    step["error_message"] = res.get("errorMessage", "")
                    step["stack_trace"] = res.get("stackTrace", "")
                steps.append(step)

            # A scenario-level (e.g. teardown/assertion) failure may be
            # attached to afterScenarioHookFailure rather than to a single
            # step — surface it too so nothing gets lost.
            hook_failure = scenario.get("afterScenarioHookFailure")

            scenarios.append({
                "heading": scenario.get("scenarioHeading", ""),
                "status": scenario.get("executionStatus", "notExecuted"),
                "steps": steps,
                "hook_failure": (
                    {
                        "error_message": hook_failure.get("errorMessage", ""),
                        "stack_trace": hook_failure.get("stackTrace", ""),
                    }
                    if hook_failure else None
                ),
            })

        specs.append({
            "heading": spec_result.get("specHeading", ""),
            "file_name": spec_result.get("fileName", ""),
            "status": spec_result.get("executionStatus", "notExecuted"),
            "scenarios": scenarios,
        })

    return {
        "specs": specs,
        "passed_scenarios": raw.get("passedScenariosCount", 0),
        "failed_scenarios": raw.get("failedScenariosCount", 0),
        "skipped_scenarios": raw.get("skippedScenariosCount", 0),
    }


async def _resolve_container_id(container_name: str, bunx_path: str) -> str:
    """Return container ID to use for docker exec.

    If *container_name* is set, match by name/id directly.
    Otherwise auto-detect the first running VS Code devcontainer that has bunx.
    """
    docker = shutil.which("docker")
    if not docker:
        raise RuntimeError("docker CLI not found. Make sure Docker/OrbStack is installed.")

    if container_name:
        # Explicit container — just verify it is running
        proc = await asyncio.create_subprocess_exec(
            docker, "ps", "--filter", f"name={container_name}",
            "--format", "{{.ID}}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        ids = [l.strip() for l in stdout.decode().split("\n") if l.strip()]
        if not ids:
            raise RuntimeError(
                f"Container '{container_name}' is not running. "
                "Check the container name in Settings."
            )
        return ids[0]

    # Auto-detect: any devcontainer with bunx
    proc = await asyncio.create_subprocess_exec(
        docker, "ps",
        "--filter", "label=devcontainer.local_folder",
        "--format", "{{.ID}}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    ids = [l.strip() for l in stdout.decode().split("\n") if l.strip()]
    if not ids:
        raise RuntimeError(
            "No VS Code devcontainer found. "
            "Open this project in VS Code with the Remote - Containers extension, "
            "or set a container name in Settings."
        )

    for cid in ids:
        check = await asyncio.create_subprocess_exec(
            docker, "exec", cid, "test", "-f", bunx_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await check.wait()
        if check.returncode == 0:
            return cid

    return ids[0]


class RunSpecRequest(BaseModel):
    spec_path: str
    line_number: Optional[int] = None


@router.post("/run-spec")
async def run_spec(payload: RunSpecRequest):
    run_cfg = get_run_settings()
    spec_base = get_spec_base()
    smart_contracts_dir = get_smart_contracts_dir()

    spec_path = payload.spec_path.strip()
    spec_file = safe_resolve(spec_base, spec_path)
    if not spec_file.exists():
        raise HTTPException(status_code=404, detail="Spec not found")

    gauge_path = f"specs/{spec_path}"
    if payload.line_number:
        gauge_path = f"{gauge_path}:{payload.line_number}"

    bunx_path = run_cfg["bunx_path"]
    container_workdir = run_cfg["container_workdir"]
    container_name = run_cfg["container_name"]

    async def generate():
        try:
            if platform.system() == "Darwin":
                # macOS host: route through docker exec into the devcontainer
                container_id = await _resolve_container_id(container_name, bunx_path)
                shell_cmd = (
                    f"cd {shlex.quote(container_workdir)} && "
                    f"{bunx_path} gauge run {shlex.quote(gauge_path)} --env ci --verbose"
                )
                docker = shutil.which("docker")
                process = await asyncio.create_subprocess_exec(
                    docker, "exec", "-i", container_id,
                    "/bin/bash", "-c", shell_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
            else:
                # Linux (inside container): run directly
                env = {
                    **os.environ,
                    "PATH": f"{os.path.dirname(bunx_path)}:{os.environ.get('PATH', '')}",
                }
                process = await asyncio.create_subprocess_exec(
                    bunx_path,
                    "gauge", "run", gauge_path, "--env", "ci", "--verbose",
                    cwd=str(smart_contracts_dir),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=env,
                )

            async for raw_line in process.stdout:
                line = _ANSI_RE.sub("", raw_line.decode("utf-8", errors="replace"))
                yield f"data: {json.dumps({'line': line})}\n\n"

                progress = _classify_progress_line(line)
                if progress is not None:
                    yield f"data: {json.dumps({'progress': progress})}\n\n"

            await process.wait()

            # Once gauge has finished, it has (re)written the json-report —
            # parse it into a compact spec › scenario › step tree so the UI
            # can show exactly where execution failed without the user having
            # to read raw stack traces.
            report = _load_json_report(smart_contracts_dir)
            if report is not None:
                yield f"data: {json.dumps({'result': report})}\n\n"

            yield f"data: {json.dumps({'done': True, 'exit_code': process.returncode})}\n\n"

        except Exception as exc:
            err_msg = f"Error: {exc}\n"
            yield f"data: {json.dumps({'line': err_msg, 'error': True})}\n\n"
            yield f"data: {json.dumps({'done': True, 'exit_code': 1})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
