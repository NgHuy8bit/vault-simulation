#!/usr/bin/env bash
# Entrypoint for the dedicated simulation-viewer runner container.
#
# All slow work (uv sync, gauge plugin, Python downloads) is done at image
# BUILD time (see simulation-viewer/runner/Dockerfile). This script only
# handles the few things that require the bind-mounted source tree to exist:
#
#   1. Git credentials          — runtime secret from .env
#   2. bun install              — creates node_modules in the bind-mount (~100 ms,
#                                  bun's package cache is pre-warmed in the image)
#   3. sitecustomize.py symlink — must point into the live smart-contracts tree
#   4. Start the Go backend
set -euo pipefail

export PATH="/home/vscode/.local/bin:/home/vscode/.bun/bin:${PATH}"
export UV_PROJECT_ENVIRONMENT="/opt/sc-venv"
export GAUGE_PYTHON_COMMAND="/opt/sc-venv/bin/python"

SC_DIR="/workspaces/smart-contracts"
VIEWER_BACKEND_BIN="/opt/viewer-backend-go/viewer"
export VIEWER_DIR="/opt"
export SMART_CONTRACTS_DIR="$SC_DIR"

# ── 1. Git credentials for any runtime git operations ──────────────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
    git config --global credential.helper store
    echo "https://${GITHUB_USER:-x-access-token}:${GITHUB_TOKEN}@github.com" > "${HOME}/.git-credentials"
    chmod 600 "${HOME}/.git-credentials"
fi
git config --global user.email "${GIT_USER_EMAIL:-viewer-runner@local}"
git config --global user.name "${GIT_USER_NAME:-viewer-runner}"
git config --global --add safe.directory "$SC_DIR"

# ── 2. bun install (fast — package cache pre-warmed in image) ──────────────
cd "$SC_DIR"
echo "==> Installing bun.sh dependencies…"
bun install --frozen-lockfile 2>/dev/null || bun install

echo "==> Setting up Lefthook…"
bunx lefthook install --force

# ── 3. sitecustomize.py symlink ────────────────────────────────────────────
# Must point into the live bind-mounted source tree, not the build-time copy.
echo "==> Linking sitecustomize.py…"
SITE_PACKAGES="$(uv run python -c 'import site; print(site.getsitepackages()[0])')"
ln -sf "${SC_DIR}/config/sitecustomize.py" "${SITE_PACKAGES}/sitecustomize.py"

# ── 4. Start backend ────────────────────────────────────────────────────────
echo "==> Starting Go viewer backend on 0.0.0.0:8000…"
exec "$VIEWER_BACKEND_BIN"
