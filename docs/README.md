# Vault Simulation Viewer Documentation

A split FastAPI + React tool for inspecting Gauge simulation test results from Vault smart contracts and editing `.spec` files visually.

## Quick Start

```bash
cd debugTool/simulation-viewer
make setup
make dev
```

Open `http://localhost:5173`. The frontend proxies `/api/*` to `http://localhost:8000`.

The legacy stdlib implementation is still available with `npm run start:legacy`.

Useful overrides:

```bash
BACKEND_PORT=8001 FRONTEND_PORT=5174 make dev
make run-be-dev
make run-fe
make test
```

## File Layout

```
simulation-viewer/
  backend/
    app/
      api/routes/    FastAPI routers
      core/          settings and path safety
      models/        Pydantic response/request models
      services/      Gauge parsing, serialization, simulation preprocessing
    requirements.txt
  frontend/
    src/
      components/    React render components and node editor
      api/           API client
      utils/         formatting and color helpers
    vite.config.js
  server.py          Legacy stdlib server
  public/            Legacy vanilla app
  docs/              This documentation folder
```

## Data Paths

| Purpose | Path |
|---------|------|
| Simulation responses | `smart-contracts/.gauge/simulation/**/*.response.json` |
| Simulation requests  | `smart-contracts/.gauge/simulation/**/*.request.json` |
| Spec files           | `smart-contracts/specs/**/*.spec` |

## Tabs Overview

| Tab | What it shows |
|-----|---------------|
| **Timeline** | All simulation steps in order; filter by type; click to see details |
| **Diagram**  | Balance history chart with zoom/pan; event strip timeline |
| **Postings** | All posting instruction batches, searchable |
| **Accounts** | Per-account balance table + history + spec params + config balances |
| **Spec**     | Visual or raw Gauge spec view; n8n-style node editor for structured steps |

## Server API

See [api.md](api.md) for full API reference.

## Gauge Spec Syntax

See [gauge-spec-syntax.md](gauge-spec-syntax.md) for the step format used in this project.

## Architecture

- **Backend:** FastAPI. It reads simulation JSON, builds event timelines, latest balances, balance history, and parses or serializes Gauge specs.
- **Frontend:** React + Vite. It does not parse Gauge syntax or simulation responses; it renders structured API data.
- **Diagram:** SVG step chart plus an event strip below the chart. The strip uses the same zoomed time range as the balance chart.
- **Spec editor:** n8n-style node palette, ordered canvas, and inspector forms. Saving sends structured JSON to `POST /api/save-spec`; backend writes valid Gauge syntax.
