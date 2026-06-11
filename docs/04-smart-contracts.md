# Smart Contracts — Deep Dive

## Vault Platform

**Vault** là nền tảng core banking của Thought Machine. Smart contracts là các chương trình Python chạy trong Vault, định nghĩa hành vi của từng loại tài khoản/sản phẩm.

Đặc điểm:
- API version: `4.0.0`
- Timezone: `Asia/Ho_Chi_Minh` (VN)
- Denomination chính: `VND`
- Hook-based execution — contract không tự gọi bất cứ thứ gì, Vault gọi vào contract khi có event

---

## Hook System

Contract định nghĩa các hooks, Vault gọi vào khi có event tương ứng:

```
activation_hook(vault, hook_arguments)
    ← Khi tài khoản vừa được tạo và kích hoạt
    ← Thường: validate params, setup initial state

pre_posting_hook(vault, hook_arguments)
    ← Trước khi posting được xử lý
    ← Trả về: Rejection (từ chối) hoặc không làm gì (cho qua)

post_posting_hook(vault, hook_arguments)
    ← Sau khi posting được chấp nhận
    ← Thường: emit thêm postings phụ (accrual, fee...)

scheduled_event_hook(vault, hook_arguments)
    ← Khi event schedule đến hạn (VD: cuối ngày, cuối tháng)
    ← Tính lãi, đáo hạn, phí, reminder notification...

pre_parameter_change_hook(vault, hook_arguments)
    ← Trước khi thay đổi instance parameter
    ← Validate xem có cho phép thay đổi không

post_parameter_change_hook(vault, hook_arguments)
    ← Sau khi parameter đã thay đổi

derived_parameter_hook(vault, hook_arguments)
    ← Vault hỏi giá trị computed parameter (VD: available_balance)
    ← Không persist, tính real-time từ state hiện tại

deactivation_hook(vault, hook_arguments)
    ← Khi tài khoản sắp bị đóng
    ← Validate điều kiện đóng tài khoản

conversion_hook(vault, hook_arguments)
    ← Khi upgrade product version
```

---

## Cấu Trúc Tài Khoản (Balance Addresses)

Mỗi tài khoản có nhiều "addresses" (balance buckets), ví dụ cho Loan:

```
PRINCIPAL           ← dư nợ gốc còn lại
PRINCIPAL_DUE       ← gốc đến hạn chưa trả
PRINCIPAL_OVERDUE   ← gốc quá hạn
INTEREST_ACCRUED    ← lãi tích lũy chưa đến hạn
INTEREST_DUE        ← lãi đến hạn
INTEREST_OVERDUE    ← lãi quá hạn
PENALTIES           ← tiền phạt
DEFAULT             ← số dư hiện tại (deposit side)
```

Balance phase:
- `POSTING_PHASE_COMMITTED` — đã xác nhận
- `POSTING_PHASE_PENDING_IN` / `POSTING_PHASE_PENDING_OUT` — đang chờ (authorization)

---

## Sản Phẩm (Products)

### Loan (Cho Vay)

Lifecycle:
```
OPEN → (repayments...) → MATURE → CLOSED
              │
              └── [overdue] → PENALTIES
```

Hooks chính:
- `activation_hook`: disbursement (giải ngân), setup schedules
- `pre_posting_hook`: validate repayment amount, reject if overdue
- `post_posting_hook`: allocate payment to principal/interest buckets
- `scheduled_event_hook`:
  - `ACCRUE_INTEREST`: tích lũy lãi hàng ngày
  - `REPAYMENT_DUE`: chuyển interest/principal → DUE
  - `CHECK_OVERDUE`: chuyển DUE → OVERDUE nếu chưa trả
  - `MATURITY`: xử lý đáo hạn

Parameters quan trọng: `principal`, `loan_term`, `annual_interest_rate`, `repayment_day`, `disbursement_type` (AUTO/MANUAL)

### Fixed Term Savings / FISA (Tiền Gửi Có Kỳ Hạn)

```
OPEN → (term running...) → MATURITY → [renewal or close]
```

Renewal modes:
- `NO_RENEWAL` — rút tiền khi đáo hạn
- `PRINCIPAL_ONLY` — tái ký chỉ gốc, lãi trả ra
- `PRINCIPAL_AND_INTEREST` — tái ký cả gốc + lãi

Hooks chính:
- `activation_hook`: deposit initial principal, setup maturity schedule
- `scheduled_event_hook`:
  - `ACCRUE_INTEREST`: tích lũy lãi hàng ngày
  - `APPLY_INTEREST`: áp lãi (định kỳ hoặc cuối kỳ)
  - `MATURITY`: xử lý đáo hạn, tái ký hoặc notify

### Current Account V2 (Tài Khoản Thanh Toán)

Features:
- Overdraft linkage (liên kết tài khoản thấu chi)
- Interest accrual/application
- Blockade support (phong tỏa tài khoản)
- Lucky money feature

Supervisor handles cross-account logic giữa current_account và overdraft.

### Savings Account (Tiết Kiệm Không Kỳ Hạn)

- Lãi tính daily, apply theo kỳ
- Không có maturity

### Overdraft (Thấu Chi)

Legacy product, linked với current_account qua Supervisor.

---

## Supervisor Contract

Supervisor là loại contract đặc biệt quản lý **nhiều** smart contracts:

```python
# metadata.py
supervised_smart_contracts = [
    SmartContractDescriptor(
        alias="current_account",
        smart_contract_version_id="...",
    ),
    SmartContractDescriptor(
        alias="overdraft",
        smart_contract_version_id="...",
    ),
]
```

Supervisor override các hooks của supervisees (với `OVERRIDE` execution mode), có thể:
- Aggregate data từ nhiều accounts
- Orchestrate cross-account postings
- Override rejection logic

---

## Build & Deploy Pipeline

### Render Contract (New Style)

```bash
script/render-contract loan
# → products/loan/contracts/rendered_loan.py
```

Dùng `inception_sdk` renderer để merge modular Python files thành 1 file deployable.

### CLU (Command Line Utility)

```bash
script/clu validate --manifest products/loan/loan.manifest.yaml
script/clu import --manifest products/loan/loan.manifest.yaml
```

Đọc `config/clu_config.json` và Core API token để kết nối Vault.

### Manifest YAML

```yaml
# loan.manifest.yaml
resources:
  - smart_contract:
      resource_id: loan_v1
      display_name: Loan
      source: contracts/rendered_loan.py
  - internal_account:
      resource_id: LOAN_PRINCIPAL_INTERNAL
      ...
```

---

## Test Framework

### Gauge Simulation Tests

Gauge spec files trong `specs/` là **integration tests** chạy simulation thật trong Vault:

1. Mỗi `## Scenario` là 1 test case
2. Gauge gọi step definitions trong `steps/simulation/main.py`
3. Steps tổng hợp thành `GaugeSimulationTestCase` (xây dựng request JSON)
4. `run_simulation()` gọi Vault API, nhận response
5. Gauge assert dựa trên response

### Pytest Unit Tests

`projects/tests/<product>/(unit|simulation|e2e)/`

- `unit/`: test logic Python thuần, mock Vault vault object
- `simulation/`: test với vault simulator nhỏ (not full Vault)
- `e2e/`: end-to-end test (cần Vault running)

### Timing Reports

Sau khi chạy suite, `main.py @after_suite` in timing report:
```
Simulation Timing Report
Run at    : 2024-01-15 10:30:00
Specs     : 12
Scenarios : 87
──────────────────────────────────────────────────────────────────────────
loan/partial_repayment.spec  (5 scenarios | total 45.2s | wall 47.1s)
  12.30s  Partial repayment during first cycle
   8.51s  Full early repayment
  ...
```

---

## Gauge Step Conventions

Step text format quan trọng (viết đúng để spec_parser classify được):

| Pattern | Type |
|---------|------|
| `At "<ts>", make an Inbound Hard Settlement of "<amt>" "<denom>" from internal account ID "..." to customer account ID "..."` | `inbound` |
| `At "<ts>", make an Outbound Hard Settlement of ...` | `outbound` |
| `At "<ts>", make a Transfer of "<amt>" "<denom>" from debtor account ID "..." to creditor account ID "..."` | `transfer` |
| `Check the balances of account "..." and denomination "..." with address:` | `balance_check` |
| `At "<ts>", verify that the transaction of account ID "..." is accepted.` | `accepted` |
| `At "<ts>", verify that the transaction of account ID "..." is rejected due to "..." with reason "..."` | `rejected` |
| `At "<ts>", verify that the expected schedule of account ID "..." with event "..."` | `schedule` |
| `Set events time zone "..."` | `config` |
| `Create a new product name "..." with product version ID "..."` | `product` |
| `Create a new account with the ID "..." with default instance parameter value on product version ID "..."` | `account` |

---

## Internal Accounts

Internal accounts là tài khoản kế toán nội bộ (counterpart cho customer accounts):

```
LOAN_PRINCIPAL_INTERNAL         ← đối ứng khi giải ngân
LOAN_INTEREST_INCOME_INTERNAL   ← thu lãi
LOAN_PENALTY_INCOME_INTERNAL    ← thu phạt
DEPOSIT_INTEREST_EXPENSE_INTERNAL ← chi lãi tiết kiệm
```

Được deploy cùng product manifest, referenced trong contract code như:
```python
vault.get_parameter_timeseries(name="loan_internal_account")
```

---

## Global Parameters

Parameters chia sẻ toàn hệ thống, không per-account:

- `cut_off_time`: giờ kết thúc ngày giao dịch
- `banking_date_gap`: độ trễ ngày ngân hàng
- `non_working_days`: danh sách ngày nghỉ
- `red_zone_minutes_before_cut_off`: cửa sổ thời gian nhạy cảm trước cut-off
