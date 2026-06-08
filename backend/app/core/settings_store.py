"""Runtime settings store — reads/writes viewer-settings.json next to the viewer root."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# ── Paths derived from this file's location ────────────────────────────────────
_THIS_FILE = Path(__file__).resolve()
# debugTool/simulation-viewer
_VIEWER_DIR = _THIS_FILE.parents[3]
# repo root (two levels above simulation-viewer: debugTool → source)
_SOURCE_ROOT = _VIEWER_DIR.parent.parent

_SETTINGS_FILE = _VIEWER_DIR / "viewer-settings.json"

# Inside the dedicated runner container (see ../../docker-compose.yml),
# `smart-contracts` is bind-mounted at /workspaces/smart-contracts and the
# path-from-this-file-location heuristic below doesn't apply (the viewer
# backend lives at /opt/viewer-backend, not under the source tree). The
# compose file sets SMART_CONTRACTS_DIR so we can short-circuit detection.
_ENV_SMART_CONTRACTS_DIR = os.environ.get("SMART_CONTRACTS_DIR", "").strip()

if _ENV_SMART_CONTRACTS_DIR:
    _DEFAULT_SMART_CONTRACTS_DIR = _ENV_SMART_CONTRACTS_DIR
else:
    _DEFAULT_SMART_CONTRACTS_DIR = str((_SOURCE_ROOT / "smart-contracts").resolve())

DEFAULTS: dict[str, str] = {
    "smart_contracts_dir": _DEFAULT_SMART_CONTRACTS_DIR,
    "container_name": "",                          # empty → auto-detect
    "container_workdir": "/workspaces/smart-contracts",
    "bunx_path": "/home/vscode/.bun/bin/bunx",
}


# ── Public helpers ─────────────────────────────────────────────────────────────

def load_settings() -> dict[str, str]:
    """Return current settings merged over defaults (reads file on every call)."""
    settings = dict(DEFAULTS)
    if _SETTINGS_FILE.exists():
        try:
            stored: dict[str, Any] = json.loads(_SETTINGS_FILE.read_text("utf-8"))
            for key in DEFAULTS:
                val = stored.get(key)
                if val is not None and str(val).strip():
                    settings[key] = str(val).strip()
        except Exception:
            pass
    return settings


def save_settings(data: dict[str, str]) -> dict[str, str]:
    """Persist only known keys; return the merged result."""
    current = load_settings()
    for key in DEFAULTS:
        if key in data and data[key] is not None:
            current[key] = str(data[key]).strip() or DEFAULTS[key]
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(current, indent=2, ensure_ascii=False), "utf-8")
    return current


# ── Per-request accessors (always re-read so changes take effect immediately) ──

def get_smart_contracts_dir() -> Path:
    return Path(load_settings()["smart_contracts_dir"])


def get_spec_base() -> Path:
    return get_smart_contracts_dir() / "specs"


def get_simulation_base() -> Path:
    return get_smart_contracts_dir() / ".gauge/simulation"


def get_run_settings() -> dict[str, str]:
    s = load_settings()
    return {
        "container_name":   s["container_name"],
        "container_workdir": s["container_workdir"],
        "bunx_path":         s["bunx_path"],
    }
