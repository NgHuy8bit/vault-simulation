PYTHON ?= python3
NPM ?= npm

BACKEND_HOST ?= 0.0.0.0
BACKEND_PORT ?= 8000
FRONTEND_HOST ?= 0.0.0.0
FRONTEND_PORT ?= 5173
API_PROXY_TARGET ?= http://localhost:$(BACKEND_PORT)

VENV := .venv
PIP := $(VENV)/bin/pip
PYTHON_BIN := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn
FRONTEND_STAMP := frontend/.deps-stamp

.PHONY: help setup setup-be setup-fe run run-be run-be-dev run-fe dev build test clean legacy \
        docker-build docker-up docker-down docker-logs

help:
	@echo "Simulation Viewer"
	@echo ""
	@echo "Docker targets (recommended):"
	@echo "  make docker-build  Build viewer-runner image (auto-grabs GitHub token from Keychain)"
	@echo "  make docker-up     Build + start all containers"
	@echo "  make docker-down   Stop and remove containers"
	@echo "  make docker-logs   Tail container logs"
	@echo ""
	@echo "Local dev targets:"
	@echo "  make setup       Create backend .venv and install frontend deps"
	@echo "  make run-be      Run FastAPI backend on BACKEND_PORT=$(BACKEND_PORT)"
	@echo "  make run-be-dev  Run FastAPI backend with reload"
	@echo "  make run-fe      Run React/Vite frontend on FRONTEND_PORT=$(FRONTEND_PORT)"
	@echo "  make dev         Run backend reload + frontend together"
	@echo "  make build       Build frontend"
	@echo "  make test        Compile backend and build frontend"
	@echo "  make clean       Remove local build/dependency artifacts"
	@echo ""
	@echo "Examples:"
	@echo "  make docker-up"
	@echo "  make dev"

setup: setup-be setup-fe

setup-be: $(UVICORN)

$(PYTHON_BIN):
	$(PYTHON) -m venv $(VENV)

$(UVICORN): backend/requirements.txt $(PYTHON_BIN)
	$(PIP) install -r backend/requirements.txt

setup-fe: $(FRONTEND_STAMP)

$(FRONTEND_STAMP): frontend/package.json $(wildcard frontend/package-lock.json)
	$(NPM) --prefix frontend install
	@touch $(FRONTEND_STAMP)

run: dev

run-be: $(UVICORN)
	$(UVICORN) app.main:app --app-dir backend --host $(BACKEND_HOST) --port $(BACKEND_PORT)

run-be-dev: $(UVICORN)
	$(UVICORN) app.main:app --app-dir backend --reload --host $(BACKEND_HOST) --port $(BACKEND_PORT)

run-fe: $(FRONTEND_STAMP)
	VITE_API_PROXY_TARGET=$(API_PROXY_TARGET) $(NPM) --prefix frontend run dev -- --host $(FRONTEND_HOST) --port $(FRONTEND_PORT)

dev: setup
	@echo "Backend:  http://localhost:$(BACKEND_PORT)"
	@echo "Frontend: http://localhost:$(FRONTEND_PORT)"
	@$(MAKE) -j2 run-be-dev run-fe

build: setup-fe
	$(NPM) --prefix frontend run build

test: setup
	$(PYTHON_BIN) -m compileall -q backend/app
	PYTHONPATH=backend $(PYTHON_BIN) -c "from app.main import app; print(app.title)"
	$(NPM) --prefix frontend run build

legacy:
	$(PYTHON) server.py

# ── Docker targets ────────────────────────────────────────────────────────────
# Auto-extracts GITHUB_TOKEN from macOS Keychain via git credential helper.
# No need to set any env var — just make sure you're already authenticated
# with GitHub (i.e. `git clone https://github.com/GalaxyFinX/...` works).

docker-build:
	@token=$$(printf 'protocol=https\nhost=github.com\n' | git credential fill 2>/dev/null | awk -F= '/^password/{print $$2}'); \
	if [ -z "$$token" ]; then \
		echo "ERROR: Could not get GitHub token from macOS Keychain."; \
		echo "       Make sure you are authenticated: git ls-remote https://github.com/GalaxyFinX/smart-contracts.git"; \
		exit 1; \
	fi; \
	echo "Using GitHub token from Keychain ($(shell printf 'protocol=https\nhost=github.com\n' | git credential fill 2>/dev/null | awk -F= '/^username/{print $$2}'))"; \
	GITHUB_TOKEN=$$token docker compose build viewer-runner

docker-up:
	@$(MAKE) docker-build
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

clean:
	rm -rf $(VENV) frontend/node_modules frontend/dist $(FRONTEND_STAMP)
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
