# Tổng Quan Dự Án

## Mục Đích

Đây là codebase phát triển **smart contracts** cho nền tảng ngân hàng **Vault** (Thought Machine). Ngoài ra có một tool nội bộ là **Simulation Viewer** để devs xem, chạy, và chỉnh sửa các test simulation.

---

## Hai Thành Phần Chính

```
source/
├── smart-contracts/          ← sản phẩm chính: contract Python + test Gauge
└── simulation-viewer/        ← dev tool: xem/chạy/sửa spec và kết quả simulation
```

---

## Smart Contracts (thành phần 1)

**Vault Smart Contracts** là các chương trình Python định nghĩa hành vi của các sản phẩm tài chính:

- Khi nào thì chấp nhận/từ chối một giao dịch?
- Lãi suất tính như thế nào?
- Khi đáo hạn thì làm gì?

Vault chạy các contract này trong sandbox; smart contract **không** gọi database hay HTTP — nó nhận input từ Vault và emit directives (postings, thông báo, lịch chạy...).

**Danh sách sản phẩm được implement:**

| Loại | Sản phẩm |
|------|----------|
| Tiền gửi | `current_account_v2`, `savings_account`, `fixed_term_savings`, `time_deposit` |
| FISA | `fisa_beginning`, `fisa_end`, `fisa_periodic` |
| Cho vay | `loan`, `salary_advance`, `overdraft` |
| Quản lý | `cash_management`, `collateral_management` |
| GL | `general_ledger_asset`, `general_ledger_liability`, `intermediary_account` |
| Orchestration | `supervisor` (cross-account) |

---

## Simulation Viewer (thành phần 2)

Một web app **chỉ dùng nội bộ** để developers:

1. **Browse** — xem cây thư mục spec files qua sidebar
2. **Visualize** — xem spec scenario dưới dạng flow diagram (ReactFlow)
3. **Run** — chạy Gauge test trực tiếp, xem log live
4. **Inspect** — phân tích kết quả simulation (events, postings, balance history)
5. **Edit** — sửa spec file trực tiếp qua UI (visual editor hoặc source editor)

**Tech stack:**

| Layer | Tech |
|-------|------|
| Frontend | React + Vite, `@xyflow/react`, vanilla CSS |
| Backend | Python FastAPI |
| Test runner | Gauge CLI (gọi qua Docker exec) |
| Giao tiếp run | Server-Sent Events (SSE stream) |

---

## Luồng Tổng Quát

```
Developer
   │
   ├─ viết spec (.spec file)
   │       ↓
   │  [Gauge test runner] ── chạy simulation trong Vault
   │       ↓
   │  Lưu kết quả (.response.json)
   │
   └─ mở Simulation Viewer
           │
           ├─ browse tree
           ├─ click spec → xem flow diagram
           ├─ click scenario → xem kết quả simulation
           └─ chỉnh sửa spec → save → re-run
```

---

## Index Tài Liệu

| File | Nội dung |
|------|----------|
| [01-architecture.md](./01-architecture.md) | Kiến trúc hệ thống, component diagram |
| [02-data-flow.md](./02-data-flow.md) | Luồng dữ liệu chi tiết của từng tính năng |
| [03-simulation-viewer.md](./03-simulation-viewer.md) | Deep dive Simulation Viewer (frontend + backend) |
| [04-smart-contracts.md](./04-smart-contracts.md) | Smart contracts: hooks, products, deployment |
| [05-spec-format.md](./05-spec-format.md) | Cú pháp file `.spec`, các loại step |
| [06-simulation-run-analysis.md](./06-simulation-run-analysis.md) | Cơ chế chạy simulation: SubTest, API call, URL/headers/body |
