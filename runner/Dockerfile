# syntax=docker/dockerfile:1.4
#
# Dedicated runner image for the Vault Simulation Viewer.
#
# Build context: source/  (parent dir — contains both smart-contracts/ and
#                           simulation-viewer/ as siblings)
# Dockerfile: simulation-viewer/runner/Dockerfile
#
# ┌──────────────────────────────────────────────────────────────────────┐
# │  FIRST BUILD (or after dependency changes):                          │
# │    GITHUB_TOKEN=ghp_xxx docker compose build viewer-runner           │
# │                                                                      │
# │  The token is passed as a BuildKit secret — it is NEVER stored in    │
# │  any image layer or visible in `docker history`.                     │
# │                                                                      │
# │  Subsequent `docker compose up` starts in ~3 seconds (no downloads). │
# └──────────────────────────────────────────────────────────────────────┘

FROM mcr.microsoft.com/devcontainers/base:bookworm

ARG UV_VERSION=0.8.9
ARG BUN_VERSION=1.2.1

# ── System packages (identical to smart-contracts devcontainer) ──────────────
RUN apt-get update && apt-get install -y \
    kcat \
    librdkafka-dev \
    && rm -rf /var/lib/apt/lists/*

# Pre-create /opt dirs as root so the non-root vscode user can write to them.
# The venv paths must exist before uv tries to create them (uv can populate
# an existing dir but cannot create parent dirs it doesn't own).
RUN mkdir -p /opt/sc-venv /opt/viewer-backend-venv \
    && chown vscode:vscode /opt/sc-venv /opt/viewer-backend-venv

USER vscode
ENV PATH="/home/vscode/.local/bin:/home/vscode/.bun/bin:${PATH}"
ENV DEVELOPMENT_MODE=1

# ── Toolchain: uv + bun ──────────────────────────────────────────────────────
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"

# ── Pre-install smart-contracts Python dependencies ──────────────────────────
# Only pyproject.toml + uv.lock are needed to resolve and download deps.
# The full source tree is bind-mounted at /workspaces/smart-contracts at
# runtime — it is NOT available here, so we use --no-install-project to
# skip installing smart-contracts itself and only install its dependencies
# (contracts-api, edge-function-api, product-library, getgauge, …).
#
# The venv lives at /opt/sc-venv inside the image, so container start only
# needs to verify it — no downloading, no building from source.
COPY --chown=vscode smart-contracts/pyproject.toml smart-contracts/uv.lock /tmp/sc-deps/
# uid=1000 = vscode user — without this the secret is root-only (0400) and
# the non-root vscode user would get a permission-denied reading it.
RUN --mount=type=secret,id=github_token,uid=1000 \
    bash -c ' \
      TOKEN=$(cat /run/secrets/github_token 2>/dev/null || true); \
      if [ -z "$TOKEN" ]; then \
        echo "ERROR: GITHUB_TOKEN secret is required to clone private dependencies."; \
        echo "  Run: GITHUB_TOKEN=ghp_xxxx docker compose build viewer-runner"; \
        exit 1; \
      fi; \
      git config --global credential.helper store; \
      printf "https://x-access-token:%s@github.com\n" "$TOKEN" > ~/.git-credentials; \
      chmod 600 ~/.git-credentials; \
      cd /tmp/sc-deps; \
      UV_PROJECT_ENVIRONMENT=/opt/sc-venv uv sync --no-install-project; \
      rm -f ~/.git-credentials; \
    '

ENV UV_PROJECT_ENVIRONMENT=/opt/sc-venv
ENV GAUGE_PYTHON_COMMAND=/opt/sc-venv/bin/python

# ── Pre-warm bun package cache + install gauge Python plugin ─────────────────
# `bun install` at runtime needs the smart-contracts node_modules (which is
# a bind-mount, so we can't bake them in). BUT bun's global package cache
# (~/.bun/install/cache) CAN be pre-populated here — that makes the
# runtime `bun install` a pure local symlink/copy operation (~100 ms).
COPY --chown=vscode smart-contracts/package.json smart-contracts/bun.lock /tmp/sc-deps/
WORKDIR /tmp/sc-deps
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# gauge Python plugin goes to ~/.gauge/plugins/ — baked into the image so
# the entrypoint never needs to download it.
RUN bunx gauge install python

# ── Pre-install viewer backend Python dependencies ────────────────────────────
# The backend source is bind-mounted at /opt/viewer-backend at runtime.
# The venv lives at /opt/viewer-backend-venv (outside the mount point) so
# it is never shadowed when the bind-mount is applied.
COPY --chown=vscode simulation-viewer/backend/requirements.txt /tmp/backend-deps/
RUN uv venv /opt/viewer-backend-venv --python 3.11 && \
    . /opt/viewer-backend-venv/bin/activate && \
    uv pip install -q -r /tmp/backend-deps/requirements.txt

# ── Runtime defaults ──────────────────────────────────────────────────────────
WORKDIR /workspaces/smart-contracts
