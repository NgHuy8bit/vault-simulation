#!/usr/bin/env bash
# Entrypoint for the dedicated simulation-viewer runner container.
#
# This container is a self-contained Linux environment (built from the same
# Dockerfile as the smart-contracts devcontainer) that:
#   1. Sets up the smart-contracts toolchain (uv venv, bun deps, Gauge Python
#      plugin) — same as `script/setup` does inside VS Code's devcontainer.
#   2. Runs the FastAPI viewer backend directly, so `gauge run` executes as a
#      plain local subprocess. No `docker exec`, no VS Code dependency.
#
# Git auth for the private `contracts-api` dependency:
#   `uv sync` needs to clone github.com/GalaxyFinX/smart-contracts. Provide a
#   GitHub Personal Access Token via the GITHUB_TOKEN env var (see .env.example
#   in this directory) — we turn it into a `~/.git-credentials` entry below.
#   This mirrors what VS Code's Remote-Containers credential helper does, just
#   with an explicit token instead of proxying your IDE's session.
set -euo pipefail

export PATH="/home/vscode/.local/bin:/home/vscode/.bun/bin:${PATH}"

SC_DIR="/workspaces/smart-contracts"
VIEWER_BACKEND_DIR="/opt/viewer-backend"
VENV_DIR="${VIEWER_BACKEND_DIR}/.venv-runner"
SETUP_STAMP="${SC_DIR}/.viewer-runner-setup-ok"

# ── 1. Git credentials for private deps ────────────────────────────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
    git config --global credential.helper store
    echo "https://${GITHUB_USER:-x-access-token}:${GITHUB_TOKEN}@github.com" > "${HOME}/.git-credentials"
    chmod 600 "${HOME}/.git-credentials"
fi
git config --global user.email "${GIT_USER_EMAIL:-viewer-runner@local}"
git config --global user.name "${GIT_USER_NAME:-viewer-runner}"
git config --global --add safe.directory "$SC_DIR"

# ── 2. One-time smart-contracts toolchain setup ─────────────────────────────
# We can't trust the stamp file alone: it lives in the bind-mounted
# smart-contracts dir and survives container rebuilds, but `.venv`'s
# interpreter is a symlink into THIS container's uv cache — if the cache
# volume is fresh (or was wiped) the symlink dangles even though the stamp
# says "done". So always verify `.venv/bin/python` actually runs; re-run
# setup if it doesn't, regardless of the stamp.
venv_python_ok() {
    "${SC_DIR}/.venv/bin/python" --version >/dev/null 2>&1
}

if [ -f "$SETUP_STAMP" ] && venv_python_ok; then
    echo "==> smart-contracts setup already done and .venv looks healthy — skipping."
else
    if [ -f "$SETUP_STAMP" ]; then
        echo "==> Stamp says setup is done, but .venv's Python is broken (likely a stale symlink from a previous container build) — re-running setup…"
        rm -f "$SETUP_STAMP"
    else
        echo "==> Running smart-contracts setup (first run only — this can take a while)…"
    fi
    (cd "$SC_DIR" && DOCKER_ENVIRONMENT=1 ./script/setup) && touch "$SETUP_STAMP" \
        || echo "!! smart-contracts setup failed — gauge run will likely fail until this is fixed. Re-run: docker compose exec viewer-runner bash -lc 'cd /workspaces/smart-contracts && ./script/setup'"
fi

# ── 3. Viewer backend's own deps (fastapi, uvicorn…) ────────────────────────
cd "$VIEWER_BACKEND_DIR"
if [ ! -x "${VENV_DIR}/bin/python" ]; then
    echo "==> Creating virtualenv for viewer backend…"
    CACHED_311="$(uv python list --only-installed 2>/dev/null | awk '/^cpython-3\.11/{print $1; exit}')"
    uv venv "$VENV_DIR" --python "${CACHED_311:-3.11}"
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
echo "==> Installing viewer backend dependencies…"
uv pip install -q -r requirements.txt

echo "==> Starting uvicorn on 0.0.0.0:8000…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
