# Luồng Dữ Liệu (Data Flows)

## Flow 1 — Khởi Động & Load Tree

Khi user mở Simulation Viewer lần đầu:

```
Browser (React App)
       │
       │ useEffect on mount
       │ GET /api/tree
       ▼
FastAPI: tree.py
       │
       ▼
tree_service.build_tree()
       │
       ├── reads: smart-contracts/specs/            (spec files)
       └── reads: smart-contracts/.gauge/simulation/ (response files)
           │
           ▼
       For each .spec file:
       ├── parse ## headings → list of scenarios
       ├── find matching .response.json files
       │   (normalized: "My Scenario Name" → "my_scenario_name")
       └── build { name, specPath, scenarios: [{name, lineNumber, responsePath}] }
           │
           ▼
       Return JSON tree:
       {
         dirs: { "loan": { path, dirs, files }, ... },
         files: [{ name, specPath, scenarios, hasResponses }]
       }
       │
       ▼
Frontend setState(tree) → Sidebar renders file tree
```

---

## Flow 2 — User Click Spec File (sidebar)

```
User clicks file "loan/partial_repayment"
       │
       ▼
handleSelect(item)  [App.jsx]
item = { name, specPath, type: 'file' }
       │
       │ parallel fetch
       ├── GET /api/parse-spec?path=loan/partial_repayment.spec
       │      │
       │      ▼
       │   spec_parser.parse_spec_content(raw_text)
       │      │
       │      ▼
       │   {
       │     title, file_tags,
       │     setup_steps: [{ type, data, line }],
       │     scenarios: [{ name, tags, line, steps: [...] }]
       │   }
       │
       └── GET /api/spec?path=loan/partial_repayment.spec
              └── returns { content: "raw text", path }
       │
       ▼
setState: spec = { path, content, parsed }
       │
       ▼
SpecView renders
       │
       ▼
specToFlow(parsed)         [specFlow.js]
   │
   ├── setup_steps → lane "Setup" (row 0)
   │   each step → ReactFlow node
   │
   └── scenarios → lane per scenario (row 1, 2, ...)
       ├── first node = scenario header
       └── subsequent nodes = steps
   │
   ▼
ReactFlow renders node graph
(all scenarios shown, filterScenarioIndex = null)
```

---

## Flow 3 — User Click Scenario (có simulation response)

```
User clicks scenario "Loan early repayment - full"
       │
item = { name, specPath, responsePath: "loan/loan/loan_early_repayment_full.response.json" }
       │
       │ parallel fetch
       ├── GET /api/scenario-summary?response-path=...
       │      │
       │      ▼
       │   simulation_processor.process_simulation_response(raw_data, request_data)
       │      │
       │      ├── raw_data = .response.json (Vault simulation output)
       │      ├── request_data = .request.json (original request sent to Vault)
       │      │
       │      ▼
       │   Iterates simulation items:
       │   - extract events: { type, timestamp, status, postings, logs }
       │   - collect balance snapshots
       │   - build balance_history per account/denomination/address
       │      │
       │      ▼
       │   Returns { events, balances, balance_history, accounts, denominations }
       │
       ├── GET /api/parse-spec
       └── GET /api/spec
       │
       ▼
setState: summary (sim data) + spec
       │
       ├── activeTab: 'spec'
       │   SpecView → shows scenario's flow with filterScenarioIndex = indexOf(scenario)
       │   (only setup lane + target scenario lane shown)
       │
       └── tabs available: spec | timeline | diagram | postings | accounts
```

---

## Flow 4 — Run Spec (chạy Gauge test)

```
User clicks "Run" button in SpecView
       │
       ▼
api.runSpec(specPath, lineNumber?)   [client.js]
POST /api/run-spec
{ spec_path: "loan/partial_repayment.spec", line_number: 42 }
       │
       ▼
run.py: StreamingResponse (Server-Sent Events)
       │
       ├── Platform = macOS → docker exec into devcontainer
       │   command: cd /workspaces/smart-contracts &&
       │            bunx gauge run specs/loan/partial_repayment.spec:42
       │            --env ci --verbose
       │
       └── Platform = Linux → run directly in current env
       │
       ▼
Gauge starts, outputs to stdout:
  # Loan Partial Repayment                    ← spec title
    ## Partial repayment - approved ✔         ← scenario
      * Set events time zone "Asia/Ho_Chi_Minh". ✔  ← step
      * Create a new product name "loan"...   ✔
      ...
       │
       │ For each stdout line:
       ├── yield SSE: { line: "raw log text" }
       └── yield SSE: { progress: { level, text, status } }
           (parsed from # / ## / * patterns)
       │
       ▼
After process exits:
   _load_json_report()
   reads .gauge/reports/json-report/result.json
   → compact: { specs: [{ scenarios: [{ steps: [{ text, status, line, error }] }] }] }
       │
       └── yield SSE: { result: <compact report> }
           yield SSE: { done: true, exit_code: 0 }
       │
       ▼
Frontend consumes SSE stream:
   runLines.push(line)       → live log display
   runProgress = {...}       → "Running: step X"
   When { result } arrives:
     buildPreciseStatusMap() → maps spec line → 'passed'|'failed' + error
     updates nodes: data.runStatus, data.runError
   When { done } arrives:
     runStatus = 'passed' | 'failed'
     ReactFlow pans to failed node (if any)
```

---

## Flow 5 — Edit & Save Spec

### 5a. Edit Full File (Visual Mode)

```
User edits nodes in SpecNodeEditor
       │
       ▼
nodes state updated (add/remove/reorder/change fields)
       │
       ▼
save() called
       │
       ▼
_buildStepsJson(nodes, title, fileTags)
   nodes → spec_data: { title, file_tags, setup_steps, scenarios }
       │
       ▼
POST /api/save-spec
{ path: "loan/test.spec", steps_json: spec_data }
       │
       ▼
specs.py → spec_serializer.serialize_spec(spec_data)
   structured JSON → Gauge markdown text
       │
       ▼
target.write_text(content)
       │
       ▼
Frontend onSpecSaved() → re-fetch + re-parse spec
```

### 5b. Edit Single Scenario (Source Mode)

```
User edits scenario source text
       │
       ▼
sourceContent (edited text) updated
       │
       ▼
save() called
       │
       ▼
_scenarioSourceSlice(spec.content, scenarioIndex)
   → { text: scenario_lines, startIdx, endIdx }

_spliceScenarioIntoContent(fullContent, startIdx, endIdx, sourceContent)
   → newContent (full file with only this scenario replaced)
       │
       ▼
POST /api/save-spec
{ path: "...", raw_content: newContent }
       │
       ▼
target.write_text(newContent)
```

---

## Flow 6 — Spec Parse Pipeline (Detail)

```
Raw .spec file text
       │
       ▼
parse_spec_content(content)
       │
       ├── Scan line by line:
       │   "# Title"    → title
       │   "tags: ..."  → file_tags (or scenario tags)
       │   "## Heading" → new scenario
       │   "* Step"     → new step
       │   "|table|row" → appended to current step
       │   "free text"  → "other" type step (annotation)
       │
       ├── Setup detection:
       │   If first scenario name contains "set up" / "setup" / "global environment"
       │   → its steps become setup_steps (shared across all scenarios)
       │
       └── Per step: _classify_step(text) → type
           ├── regex matching on step text
           ├── returns one of 30+ types:
           │   "inbound", "outbound", "transfer", "balance_check",
           │   "posting_instruction_batch", "notification", "schedule", ...
           └── _parse_step(text, table_rows, type) → { type, data: {...} }
       │
       ▼
Returns ParsedSpec:
{
  title: str,
  file_tags: [str],
  setup_steps: [ParsedStep],
  scenarios: [
    {
      name: str,
      tags: [str],
      line: int,           ← 1-based line number of "## Heading"
      steps: [ParsedStep]
    }
  ]
}
```

---

## Flow 7 — Node Status Update (Post-Run)

```
After SSE { result: report } received
       │
       ▼
buildPreciseStatusMap(result, spec.content)
       │
       ├── Parse report: spec → scenarios → steps
       │
       ├── For each step:
       │   step.line (from json-report span.start)
       │   → statusMap[lineNumber] = { status, error, stackTrace }
       │
       └── afterScenarioHookFailure
           → map to scenario's line number
       │
       ▼
nodes.map(node => {
  const info = statusMap[node.data._specLine]
  return {
    ...node,
    data: {
      ...node.data,
      runStatus: info?.status || 'skipped',
      runError: info?.error || null
    }
  }
})
       │
       ▼
ReactFlow re-renders:
   ✔ green dot  ← passed
   ✗ red dot + error banner ← failed
   ○ no dot ← skipped / not executed
       │
       ▼
If failed nodes exist:
   filterScenarioIndex != null → fitView (all nodes visible)
   filterScenarioIndex == null → setCenter on first failed node
```

---

## Sơ Đồ Trạng Thái App

```
                    ┌─────────────┐
                    │   INITIAL   │
                    │  tree=null  │
                    └──────┬──────┘
                           │ GET /api/tree
                           ▼
                    ┌─────────────┐
                    │ TREE LOADED │
                    │ no selection│
                    └──────┬──────┘
                           │ user clicks
                    ┌──────▼──────────────┐
              ┌─────┤   FILE SELECTED     ├─────┐
              │     │ spec=loaded         │     │
              │     │ summary=null        │     │
              │     │ tabs=[spec]         │     │
              │     └─────────────────────┘     │
              │                                 │ user clicks
              │ user clicks scenario             │ scenario with
              │ without response                 │ response
              │                                 ▼
              │                    ┌────────────────────────┐
              │                    │   SCENARIO + SIM DATA  │
              │                    │   spec=loaded          │
              │                    │   summary=loaded       │
              │                    │   tabs=[spec, timeline,│
              │                    │   diagram, postings,   │
              │                    │   accounts]            │
              │                    └────────────┬───────────┘
              │                                 │
              └──────────────┬──────────────────┘
                             │ click "Run"
                    ┌────────▼────────┐
                    │   RUNNING       │
                    │ runStatus=running│
                    │ live log stream  │
                    └────────┬────────┘
                      exit 0 │       │ exit 1
           ┌─────────────────┘       └───────────────┐
           ▼                                         ▼
    ┌──────────────┐                        ┌──────────────────┐
    │   PASSED     │                        │     FAILED       │
    │ nodes=green  │                        │ failed nodes=red │
    │              │                        │ error shown      │
    └──────────────┘                        └──────────────────┘
```
