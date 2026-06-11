# Kiến Trúc Hệ Thống

## System Architecture

```mermaid
graph TB
    subgraph MAC["🖥️  macOS Developer Machine"]

        subgraph COMPOSE["docker compose up"]

            subgraph RUNNER["viewer-runner container  :8001→8000"]
                BE["**Backend (FastAPI)**\n─────────────────────\nGET  /api/tree\nGET  /api/parse-spec\nGET  /api/scenario-summary\nPOST /api/run-spec ← SSE\nPOST /api/save-spec\n─────────────────────\nuvicorn app.main:app"]

                GAUGE["**gauge run** (subprocess)\nbunx gauge run specs/…\n--env ci --verbose\n─────────────────────\nGaugeSimulationTestCase\n.run_simulation()"]
            end

            FE["**viewer-frontend container  :5173**\nReact · Vite\n─────────────────────\nApp.jsx · Sidebar\nSpecView · SpecNodeEditor\nTimeline · Postings · Accounts\n─────────────────────\nVITE_API_PROXY_TARGET → viewer-runner:8000"]
        end

        FS["**bind-mount: smart-contracts/**\n─────────────────────────────────────\nspecs/**/*.spec\n.gauge/simulation/*.response.json\n.gauge/simulation/*.request.json\n.gauge/reports/json-report/result.json\nproducts/ · contracts_sdk/\nsteps/simulation/main.py"]
    end

    VAULT["**Vault Simulation Engine**\n────────────────────────\nSmart Contract Hooks\nactivation · pre/post_posting\nscheduled_event · derived_parameter\n────────────────────────\nProducts: loan · current_account_v2\nfixed_term_savings · fisa\nsavings · overdraft · supervisor..."]

    FE -- "HTTP/SSE\nhttp://viewer-runner:8000" --> BE
    BE -- "subprocess stdout\n(local, no docker exec)" --> GAUGE
    GAUGE -- "SSE log stream" --> BE
    BE -- "read/write" --> FS
    GAUGE -- "saves *.json" --> FS
    GAUGE -- "simulation request" --> VAULT
    VAULT -- "simulation response" --> GAUGE
```

> **Lưu ý**: Cách cũ (backend chạy trên macOS host → `docker exec` vào VS Code devcontainer) vẫn còn trong code tại `run.py` như fallback khi chạy `make dev` không qua Docker. Cách mới (docker compose) là standard — backend chạy thẳng trong container Linux nên gauge là local subprocess bình thường.

---

## Hai Cách Chạy

```mermaid
flowchart LR
    subgraph A["🐳 Docker Compose (standard)"]
        direction TB
        A1["docker compose up -d"] --> A2["viewer-runner container\n(backend + gauge bên trong)"]
        A2 --> A3["gauge chạy như\nsubprocess thường\n(Linux path)"]
    end

    subgraph B["⚙️  make dev (fallback, macOS host)"]
        direction TB
        B1["make dev"] --> B2["Backend chạy trên macOS host\n(uvicorn local)"]
        B2 --> B3["docker exec vào\nVS Code devcontainer\n(Darwin path)"]
    end

    A -.->|"recommended"| OK1["✅ ổn định\nkhông cần VS Code mở"]
    B -.->|"legacy/dev"| OK2["⚠️ cần devcontainer\nđang chạy"]
```

---

## Component Diagram — Backend

```mermaid
graph LR
    subgraph ROUTES["API Routes"]
        R1["tree.py\nGET /api/tree"]
        R2["specs.py\nGET /api/spec\nGET /api/parse-spec\nPOST /api/save-spec"]
        R3["scenarios.py\nGET /api/scenario-summary"]
        R4["run.py\nPOST /api/run-spec"]
        R5["settings.py\nGET/POST/DELETE /api/settings"]
    end

    subgraph SERVICES["Services"]
        S1["tree_service\nbuild_tree()"]
        S2["spec_parser\nparse_spec_content()"]
        S3["spec_serializer\nserialize_spec()"]
        S4["simulation_processor\nprocess_simulation_response()"]
    end

    subgraph CORE["Core"]
        C1["settings_store\nget_spec_base()\nget_simulation_base()"]
        C2["paths\nsafe_resolve()"]
    end

    R1 --> S1
    R2 --> S2
    R2 --> S3
    R3 --> S4
    R4 --> C1
    S1 --> C1
    S2 --> C2
    S4 --> C2
```

---

## Component Diagram — Frontend

```mermaid
graph TD
    APP["App.jsx\nstate: tree · selectedItem · spec · summary\nrunStateCacheRef: Map&lt;specPath, runState&gt;"]

    APP --> SB["Sidebar\n└ FileTree (recursive)\n  ├ DirectoryNode\n  └ SpecFileNode → ScenarioItem"]

    APP --> SV["SpecView\n(tab: spec — always)"]
    APP --> TL["Timeline\n(tab: timeline)"]
    APP --> PO["Postings\n(tab: postings)"]
    APP --> AC["Accounts\n(tab: accounts)"]
    APP --> DG["Diagram\n(tab: diagram)"]

    SV --> VIS["SpecVisual\nReactFlow canvas\nfilterScenarioIndex\nrun status overlay"]
    SV --> NDP["NodeDetailPanel\nslide-in on node click\nerror banner nếu failed"]
    SV --> SNE["SpecNodeEditor\nvisual mode · source mode\nfull file · single scenario"]
    SV --> RC["Run Controls\nStart / Stop\nlive log drawer"]

    VIS --> SCN["SpecCustomNode\n30+ loại node\nmàu accent per type"]
    VIS --> STF["specToFlow()\nspec JSON → nodes/edges/lanes"]
```

---

## Component Diagram — Smart Contracts

```mermaid
graph TD
    subgraph PRODUCTS["products/ (New Style)"]
        P1["loan/\n├ contracts/loan.py\n├ contracts/rendered_loan.py\n└ loan.manifest.yaml"]
        P2["current_account_v2/\nfixed_term_savings/\nfisa_beginning/ …"]
    end

    subgraph LEGACY["projects/products/ (Legacy)"]
        L1["current_account/\noverdraft/\ntime_deposit/\nsupervisor/"]
    end

    subgraph SPECS["specs/"]
        SP["loan/*.spec\ncurrent_account_v2/*.spec\nfixed_term_savings/*.spec …"]
    end

    subgraph STEPS["steps/simulation/"]
        ST["main.py\n@before_spec · @before_scenario\n@after_scenario · @after_spec\nGaugeSimulationTestCase"]
    end

    subgraph SCRIPTS["script/"]
        SC1["render-contract → rendered_&lt;product&gt;.py"]
        SC2["clu → validate / import → Vault"]
    end

    SP --> ST
    P1 --> SC1
    SC1 --> SC2
    P2 --> SC1
    L1 --> SC2
```

---

## Deploy Pipeline

```mermaid
flowchart LR
    A["✏️  Edit\ncontract source"] --> B["script/render-contract\nmerge modular → rendered_*.py"]
    B --> C["Resource YAML\ntrỏ vào artifact"]
    C --> D["Manifest YAML\ngroup resource IDs"]
    D --> E["script/clu\nvalidate / import"]
    E --> F["✅ Vault\ncontract live"]
```

---

## Test / Simulation Pipeline

```mermaid
flowchart LR
    A["✏️  Write\n.spec file"] --> B["Gauge runner\nđọc spec steps"]
    B --> C["steps/simulation/main.py\ntổng hợp instructions"]
    C --> D["GaugeSimulationTestCase\n.run_simulation()"]
    D --> E["Vault API\nchạy contract sandbox"]
    E --> F["Save\n*.response.json\n*.request.json"]
    F --> G["Simulation Viewer\nhiển thị kết quả"]
```

---

## Run Spec — SSE Stream Flow

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BE as Backend (inside container)
    participant G  as gauge subprocess
    participant V  as Vault

    FE->>BE: POST /api/run-spec {spec_path, line_number}
    Note over BE: platform=Linux → run directly<br/>bunx gauge run specs/…:42 --verbose
    BE->>G: asyncio.create_subprocess_exec()
    loop stdout lines
        G-->>BE: raw log line
        BE-->>FE: SSE {line: "..."}
        BE-->>FE: SSE {progress: {level, text, status}}
    end
    G->>V: simulation request
    V-->>G: simulation response → saves *.json
    G-->>BE: exit 0 / 1
    BE->>BE: _load_json_report() ← result.json
    BE-->>FE: SSE {result: {specs, scenarios, steps}}
    BE-->>FE: SSE {done: true, exit_code: 0}
    FE->>FE: buildPreciseStatusMap()\noverlay passed/failed on nodes
```

---

## Spec Parse Pipeline

```mermaid
flowchart TD
    A["Raw .spec text"] --> B["parse_spec_content()"]
    B --> C{Line type?}
    C -- "# Title" --> D["title"]
    C -- "tags: ..." --> E["file_tags / scenario tags"]
    C -- "## Heading" --> F["new scenario"]
    C -- "* Step text" --> G["_classify_step(text)\n→ 30+ types"]
    C -- "| table row |" --> H["append to current step"]
    C -- "free text" --> I["type = 'other'\n(annotation node)"]
    G --> J["_parse_step(text, table)\n→ {type, data: {...}}"]
    D & E & F & J & I --> K["ParsedSpec\n{title, file_tags, setup_steps, scenarios}"]
    K --> L["specToFlow()\n→ ReactFlow nodes/edges/lanes"]
```

---

## Node Status After Run

```mermaid
flowchart LR
    A["SSE {result: report}"] --> B["buildPreciseStatusMap()\nmap spec_line → {status, error}"]
    B --> C["nodes.map()\ndata.runStatus · data.runError"]
    C --> D{status?}
    D -- "passed" --> E["🟢 green dot"]
    D -- "failed" --> F["🔴 red dot\n+ error banner"]
    D -- "skipped" --> G["⚫ no dot"]
    C --> H{filterScenarioIndex?}
    H -- "!= null\n(single scenario)" --> I["fitView(padding: 0.15)"]
    H -- "null\n(full spec)" --> J["setCenter on\nfirst failed node"]
```
