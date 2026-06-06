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

.PHONY: help setup setup-be setup-fe run run-be run-be-dev run-fe dev build test clean legacy

help:
	@echo "Simulation Viewer"
	@echo ""
	@echo "Targets:"
	@echo "  make setup       Create backend .venv and install frontend deps"
	@echo "  make run-be      Run FastAPI backend on BACKEND_PORT=$(BACKEND_PORT)"
	@echo "  make run-be-dev  Run FastAPI backend with reload"
	@echo "  make run-fe      Run React/Vite frontend on FRONTEND_PORT=$(FRONTEND_PORT)"
	@echo "  make dev         Run backend reload + frontend together"
	@echo "  make build       Build frontend"
	@echo "  make test        Compile backend and build frontend"
	@echo "  make clean       Remove local build/dependency artifacts"
	@echo "  make legacy      Run old stdlib viewer"
	@echo ""
	@echo "Examples:"
	@echo "  make dev"
	@echo "  BACKEND_PORT=8001 FRONTEND_PORT=5174 make dev"

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
	cd backend && ../$(PYTHON_BIN) -c "from app.main import app; print(app.title)"
	$(NPM) --prefix frontend run build

legacy:
	$(PYTHON) server.py

clean:
	rm -rf $(VENV) frontend/node_modules frontend/dist $(FRONTEND_STAMP)
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
