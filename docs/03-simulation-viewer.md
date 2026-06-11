# Simulation Viewer — Deep Dive

## Tổng Quan

Simulation Viewer là một web app nội bộ để developers làm việc với Gauge spec files và kết quả simulation Vault. Nằm ở `simulation-viewer/`.

---

## Backend (FastAPI)

### Cấu Trúc

```
simulation-viewer/backend/
├── app/
│   ├── main.py              ← FastAPI app factory
│   ├── api/routes/
│   │   ├── tree.py          GET /api/tree
│   │   ├── specs.py         GET /api/spec, /api/parse-spec, POST /api/save-spec
│   │   ├── scenarios.py     GET /api/scenario-summary
│   │   ├── run.py           POST /api/run-spec (SSE)
│   │   ├── files.py         GET /api/files (raw file access)
│   │   └── settings.py      GET/POST/DELETE /api/settings
│   ├── services/
│   │   ├── tree_service.py
│   │   ├── spec_parser.py
│   │   ├── spec_serializer.py
│   │   └── simulation_processor.py
│   └── core/
│       ├── config.py
│       ├── paths.py          ← safe_resolve() chống path traversal
│       └── settings_store.py ← đọc/ghi viewer-settings.json
└── requirements.txt
```

### API Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/tree` | Cây thư mục spec + response files |
| GET | `/api/spec?path=` | Raw content của spec file |
| GET | `/api/parse-spec?path=` | Parsed JSON của spec file |
| POST | `/api/save-spec` | Lưu spec file (visual JSON hoặc raw text) |
| GET | `/api/find-spec?response-path=` | Tìm spec file tương ứng với response |
| GET | `/api/scenario-summary?response-path=` | Process simulation response |
| POST | `/api/run-spec` | Chạy Gauge test, stream output qua SSE |
| GET | `/api/settings` | Đọc viewer settings |
| POST | `/api/settings` | Lưu viewer settings |
| DELETE | `/api/settings` | Reset về defaults |
| GET | `/api/containers` | List running Docker containers |

### Settings

Settings được lưu tại `simulation-viewer/viewer-settings.json`:

```json
{
  "smart_contracts_dir": "/Users/.../Finx/source/smart-contracts",
  "container_name": "",
  "container_workdir": "/workspaces/smart-contracts",
  "bunx_path": "/home/vscode/.bun/bin/bunx"
}
```

- `smart_contracts_dir`: đường dẫn tới thư mục smart-contracts (auto-detect từ relative path)
- `container_name`: tên devcontainer (empty = auto-detect)
- `container_workdir`: working dir bên trong container
- `bunx_path`: đường dẫn tới bunx binary trong container

### Run Spec (SSE Stream)

`POST /api/run-spec` trả về Server-Sent Events stream:

```
data: {"line": "# Loan Partial Repayment\n"}

data: {"progress": {"level": "spec", "text": "Loan Partial Repayment", "status": "running"}}

data: {"line": "  ## Partial repayment - approved ✔\n"}

data: {"progress": {"level": "scenario", "text": "Partial repayment - approved", "status": "running"}}

data: {"line": "    * Set events time zone \"Asia/Ho_Chi_Minh\". ✔\n"}

data: {"progress": {"level": "step", "text": "Set events time zone ...", "status": "passed"}}

...

data: {"result": { "specs": [...], "passed_scenarios": 3, "failed_scenarios": 0 }}

data: {"done": true, "exit_code": 0}
```

Trên macOS: run qua `docker exec -i <container_id> /bin/bash -c "cd ... && bunx gauge run ..."`
Trên Linux: run trực tiếp `bunx gauge run ...`

---

## Frontend (React + Vite)

### Cấu Trúc Component

```
App.jsx
├── Sidebar
│   └── FileTree (recursive)
│       ├── DirectoryNode (collapsible)
│       └── SpecFileNode
│           └── ScenarioItem
│
└── Main
    ├── Header (title + tab nav + settings button)
    ├── SettingsPanel (modal)
    └── Content
        ├── SpecView          [tab: spec]
        ├── Timeline          [tab: timeline] - chỉ khi có sim data
        ├── Diagram           [tab: diagram]
        ├── Postings          [tab: postings]
        └── Accounts          [tab: accounts]
```

### SpecView — Component Chính

`SpecView.jsx` là component phức tạp nhất, gồm 3 phần chính:

```
SpecView
├── SpecVisual             ← ReactFlow canvas
│   ├── lanes             ← horizontal rows (setup + 1 per scenario)
│   ├── filteredNodes     ← filter by filterScenarioIndex
│   ├── run status        ← overlays passed/failed/running dots
│   └── NodeDetailPanel   ← slide-in panel khi click node
│
├── SpecNodeEditor        ← editor (hiện khi bấm "Edit spec")
│   ├── Visual mode       ← edit nodes by form fields
│   └── Source mode       ← edit raw spec text
│
└── Run controls
    ├── Start / Stop button
    ├── Live log drawer
    └── Status banner (passed/failed/N scenarios)
```

### filterScenarioIndex

Quyết định xem diagram hiện bao nhiêu scenario:

- `null` → hiện tất cả scenario (user click spec file)
- `0, 1, 2...` → hiện chỉ 1 scenario + setup (user click scenario)

```javascript
const filterScenarioIndex = useMemo(() => {
  if (selectedItem.type !== 'scenario' || !selectedItem.lineNumber) return null;
  return scenarioLineList.indexOf(selectedItem.lineNumber);
}, [selectedItem, scenarioLineList]);
```

`scenarioLineList` là array các line numbers của `## heading` trong file spec content — dùng vị trí (index) thay vì tên vì có thể trùng tên.

### Run State Cache

State của run (log, status, kết quả) được cache trong `App.jsx`:

```javascript
const runStateCacheRef = useRef(new Map());
// Map<specPath, { runLines, runStatus, runProgress, runResult, ... }>
```

Khi switch sang spec khác rồi quay lại, run state được restore từ cache → không mất log.

### specToFlow() — Chuyển Spec → Diagram

```javascript
specToFlow(parsed) → { nodes, edges, lanes, laneGap }

// Setup lane (row 0) — chứa steps trước ## heading đầu tiên
// Scenario lanes (row 1, 2, ...) — mỗi scenario 1 lane
// Node positions: x = LANE_START_X + index * NODE_GAP_X (500px)
//                y = LANE_START_Y + laneIndex * LANE_GAP_Y (300px)
// Edges: sequential chain trong mỗi lane
```

Khi `filterScenarioIndex != null`:
- Chỉ giữ setup lane + target lane
- Dịch chuyển (yOffset) target lane về phía trên để không có khoảng trắng lớn

### Node Types (SpecCustomNode)

30+ loại node, mỗi loại có màu accent border khác nhau:

| Loại | Màu | Ý nghĩa |
|------|-----|---------|
| `scenario` | Tím | Header của scenario |
| `inbound` | Xanh lá | Tiền vào (inbound hard settlement) |
| `outbound` | Đỏ | Tiền ra (outbound hard settlement) |
| `transfer` | Cam | Chuyển khoản |
| `balance_check` | Xanh ngọc | Kiểm tra số dư |
| `account` | Cyan | Tạo tài khoản |
| `product` | Xanh dương | Tạo product |
| `config` | Xám | Cấu hình (timezone, timestamp) |
| `schedule` | Tím nhạt | Scheduled event |
| `notification` | Tím hoa | Contract notification |
| `flag` | Cam nhạt | Feature flag |
| `posting_instruction_batch` | Cam | Batch postings |
| `other` | Xám tối | Annotation / free text (dạng comment `//`) |

### NodeDetailPanel — Chi Tiết Node

Khi click vào node, slide-in panel hiện ra với đầy đủ thông tin:
- Header: type badge + run status
- Error banner (đỏ): hiện khi node failed + nội dung lỗi
- Body: fields tuỳ theo type (amount, accounts, balance rows, table data...)

### SpecNodeEditor — Editor

Hai mode:
1. **Visual mode** — edit từng field qua form (name, value, timestamp, account...)
2. **Source mode** — edit raw Gauge markdown text trực tiếp

Hai scope:
1. **Full file** — edit toàn bộ spec
2. **Single scenario** — chỉ edit 1 scenario, các scenario khác không thay đổi

Source mode single scenario dùng `_scenarioSourceSlice()` để extract đoạn text của scenario, sau đó `_spliceScenarioIntoContent()` để ghép lại vào file gốc.

---

## Tabs Simulation Data

Chỉ hiện khi có `.response.json` (sim data):

### Timeline Tab
Hiển thị các events theo thứ tự thời gian:
- Mỗi event = 1 dòng: timestamp, type, amount, status
- Click để xem detail

### Diagram Tab
Flow diagram của postings:
- Nodes = accounts
- Edges = posting instructions
- Tự động layout

### Postings Tab
Danh sách posting instruction batches:
- Group theo timestamp
- Hiện từng posting instruction (debit/credit)

### Accounts Tab
Bảng số dư tài khoản:
- Latest balance per account/denomination/address
- Balance history chart
- Instance parameters

---

## Settings Panel

Mở bằng nút ⚙ ở topbar:

| Setting | Mô tả | Default |
|---------|-------|---------|
| Smart Contracts Dir | Đường dẫn tới thư mục smart-contracts | auto-detect |
| Container Name | Tên devcontainer (empty = auto-detect) | empty |
| Container Workdir | Working dir trong container | `/workspaces/smart-contracts` |
| Bunx Path | Đường dẫn bunx trong container | `/home/vscode/.bun/bin/bunx` |

---

## Docker & Deployment

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    volumes:
      - ../smart-contracts:/workspaces/smart-contracts:ro
    environment:
      - SMART_CONTRACTS_DIR=/workspaces/smart-contracts

  frontend:
    build: ./frontend
    ports: ["5173:5173"]
```

Khi chạy trong Docker, `SMART_CONTRACTS_DIR` env var override auto-detection.
