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

from app.core.config import SMART_CONTRACTS_DIR, SPEC_BASE
from app.core.paths import safe_resolve

router = APIRouter(prefix="/api", tags=["run"])

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# Absolute path to bunx inside the Linux devcontainer
_BUNX_IN_CONTAINER = "/home/vscode/.bun/bin/bunx"
# Working directory inside the container (devcontainer mounts at /workspaces/smart-contracts)
_CWD_IN_CONTAINER = "/workspaces/smart-contracts"


async def _find_devcontainer_id() -> str:
    """Return the ID of the first running VS Code devcontainer."""
    docker = shutil.which("docker")
    if not docker:
        raise RuntimeError("docker CLI not found. Make sure Docker/OrbStack is installed.")

    proc = await asyncio.create_subprocess_exec(
        docker, "ps",
        "--filter", "label=devcontainer.local_folder",
        "--format", "{{.ID}}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    ids = [line.strip() for line in stdout.decode().split("\n") if line.strip()]
    if not ids:
        raise RuntimeError(
            "No VS Code devcontainer found. "
            "Open this project in VS Code with the Remote - Containers extension."
        )

    # Prefer the container that actually has bunx
    docker_bin = docker
    for cid in ids:
        check = await asyncio.create_subprocess_exec(
            docker_bin, "exec", cid, "test", "-f", _BUNX_IN_CONTAINER,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await check.wait()
        if check.returncode == 0:
            return cid

    # Fall back to first container if none passed the check
    return ids[0]


class RunSpecRequest(BaseModel):
    spec_path: str
    line_number: Optional[int] = None


@router.post("/run-spec")
async def run_spec(payload: RunSpecRequest):
    spec_path = payload.spec_path.strip()
    spec_file = safe_resolve(SPEC_BASE, spec_path)
    if not spec_file.exists():
        raise HTTPException(status_code=404, detail="Spec not found")

    gauge_path = f"specs/{spec_path}"
    if payload.line_number:
        gauge_path = f"{gauge_path}:{payload.line_number}"

    async def generate():
        try:
            if platform.system() == "Darwin":
                # macOS host: route through docker exec into the devcontainer
                container_id = await _find_devcontainer_id()
                shell_cmd = (
                    f"cd {shlex.quote(_CWD_IN_CONTAINER)} && "
                    f"{_BUNX_IN_CONTAINER} gauge run {shlex.quote(gauge_path)} --env ci"
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
                bunx = _BUNX_IN_CONTAINER
                env = {
                    **os.environ,
                    "PATH": f"{os.path.dirname(bunx)}:{os.environ.get('PATH', '')}",
                }
                process = await asyncio.create_subprocess_exec(
                    bunx,
                    "gauge", "run", gauge_path, "--env", "ci",
                    cwd=str(SMART_CONTRACTS_DIR),
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
