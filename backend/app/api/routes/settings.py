"""Settings + container-listing endpoints."""
from __future__ import annotations

import asyncio
import shutil
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.settings_store import DEFAULTS, load_settings, save_settings

router = APIRouter(prefix="/api", tags=["settings"])


# ── Models ─────────────────────────────────────────────────────────────────────

class SettingsPayload(BaseModel):
    smart_contracts_dir: Optional[str] = None
    container_name: Optional[str] = None
    container_workdir: Optional[str] = None
    bunx_path: Optional[str] = None


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings():
    """Return current effective settings and their defaults."""
    current = load_settings()
    return {"settings": current, "defaults": DEFAULTS}


@router.post("/settings")
def update_settings(payload: SettingsPayload):
    """Persist settings and return updated values."""
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    updated = save_settings(data)
    return {"settings": updated, "defaults": DEFAULTS}


@router.delete("/settings")
def reset_settings():
    """Reset all settings to defaults."""
    updated = save_settings(dict(DEFAULTS))
    return {"settings": updated, "defaults": DEFAULTS}


@router.get("/containers")
async def list_containers():
    """Return running Docker containers (name + id) for the container picker."""
    docker = shutil.which("docker")
    if not docker:
        return {"containers": [], "error": "docker CLI not found"}

    try:
        proc = await asyncio.create_subprocess_exec(
            docker, "ps",
            "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            return {"containers": [], "error": stderr.decode().strip()}

        containers = []
        for line in stdout.decode().splitlines():
            parts = line.strip().split("\t")
            if len(parts) >= 2:
                containers.append({
                    "id": parts[0],
                    "name": parts[1],
                    "image": parts[2] if len(parts) > 2 else "",
                    "status": parts[3] if len(parts) > 3 else "",
                })
        return {"containers": containers}
    except Exception as exc:
        return {"containers": [], "error": str(exc)}
