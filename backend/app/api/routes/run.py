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
                    f"{bunx_path} gauge run {shlex.quote(gauge_path)} --env ci"
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
                    "gauge", "run", gauge_path, "--env", "ci",
                    cwd=str(smart_contracts_dir),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=env,
                )

            async for raw_line in process.stdout:
                line = _ANSI_RE.sub("", raw_line.decode("utf-8", errors="replace"))
                yield f"data: {json.dumps({'line': line})}\n\n"

            await process.wait()
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
