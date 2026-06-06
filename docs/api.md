# Server API Reference

The simulation viewer backend is a FastAPI app in `backend/app`. All API endpoints return JSON.

## Base URL

`http://localhost:8000`

---

## GET /api/tree

Returns the directory tree of simulation output files.

**Response:**
```json
{
  "dirs": {
    "loan": {
      "path": "loan",
      "dirs": {
        "repayment": {
          "path": "loan/repayment",
          "dirs": {},
          "files": [
            {
              "name": "early_termination",
              "responsePath": "loan/repayment/early_termination/scenario_name.response.json",
              "requestPath": "loan/repayment/early_termination/scenario_name.request.json"
            }
          ]
        }
      },
      "files": []
    }
  },
  "files": []
}
```

Source path: `smart-contracts/.gauge/simulation/`

---

## GET /api/file?path=\<relative-path\>

Reads a simulation response or request JSON file.

**Query params:**
- `path` — path relative to the simulation base directory

**Response:** The raw parsed JSON contents of the file.

**Errors:**
- `400` — missing path
- `403` — path traversal attempt
- `404` — file not found
- `500` — parse error

---

## GET /api/scenario-summary?response-path=\<relative-path\>

Reads a simulation `.response.json` file and returns pre-processed viewer data.

**Query params:**
- `response-path` — path of the `.response.json` file relative to simulation base

**Response:**
```json
{
  "events": [
    {
      "id": 0,
      "timestamp": "2024-01-01T01:00:00Z",
      "type": "posting",
      "status": "accepted",
      "rejection_reason": "",
      "account_id": "ACCOUNT",
      "postings": [],
      "notification_type": "",
      "notification_details": {}
    }
  ],
  "balances": {},
  "balance_history": {},
  "account_history": {},
  "accounts": [],
  "denominations": [],
  "time_range": { "start": "", "end": "" }
}
```

Event `type` is normalized to `posting`, `accrual`, `notification`, or `setup`.
The frontend uses `status` to color posting events as accepted or rejected.

---

## GET /api/find-spec?response-path=\<relative-path\>

Finds and reads the Gauge spec file corresponding to a simulation response file.

The server maps the response path to a spec path by taking the parent directory and appending `.spec`:
`loan/repayment/early_termination/scenario.response.json` → `specs/loan/repayment/early_termination.spec`

**Query params:**
- `response-path` — path of the `.response.json` file relative to simulation base

**Response (found):**
```json
{
  "found": true,
  "content": "# Spec Title\n\n## Scenario...",
  "path": "loan/repayment/early_termination.spec"
}
```

**Response (not found):**
```json
{ "found": false }
```

---

## GET /api/spec?path=\<relative-path\>

Reads a spec file by explicit relative path (relative to `specs/` directory).

**Query params:**
- `path` — path relative to the specs base directory

**Response:**
```json
{
  "content": "# Spec Title\n\n...",
  "path": "loan/repayment/early_termination.spec"
}
```

---

## GET /api/parse-spec?path=\<relative-path\>

Parses a Gauge spec into structured data for the visual view and editor.

**Response:**
```json
{
  "title": "Spec Title",
  "file_tags": ["tag"],
  "setup_steps": [],
  "scenarios": [
    {
      "name": "Scenario name",
      "tags": [],
      "steps": [
        { "type": "account", "raw": "Create a new account...", "data": {} }
      ]
    }
  ]
}
```

The browser should render these objects directly and should not parse Gauge syntax.

---

## POST /api/save-spec

Creates or overwrites a spec file. Prefer structured `steps_json`; raw content is only a fallback.

**Request body (JSON):**
```json
{
  "path": "loan/repayment/my_new_test.spec",
  "steps_json": {
    "title": "My Test",
    "file_tags": [],
    "setup_steps": [],
    "scenarios": []
  }
}
```

Raw fallback:
```json
{
  "path": "loan/repayment/my_new_test.spec",
  "raw_content": "# My Test\n\n## Scenario\n\n* Step here.\n"
}
```

**Security:**
- `path` must end in `.spec`
- Path traversal is rejected (path must resolve inside `specs/` directory)
- Parent directories are created automatically
- Balance-check rows are serialized in ascending timestamp order

**Response (success):**
```json
{ "ok": true, "path": "loan/repayment/my_new_test.spec" }
```

**Errors:**
- `400` — path does not end in `.spec`
- `403` — path traversal attempt

---

## Frontend

The React frontend runs separately from `frontend/` on `http://localhost:5173`.
Vite proxies `/api/*` to the FastAPI backend during local development.
