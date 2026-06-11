# Gauge Spec File Format

## Cấu Trúc Tổng Quát

```
# Tên Spec File

tags: TAG1, TAG2

* Setup step 1 (chạy trước TẤT CẢ scenarios)
* Setup step 2

## Tên Scenario 1
tags: AC1, regression

* Step 1
* Step 2
  | col1 | col2 |
  | ---- | ---- |
  | val1 | val2 |

## Tên Scenario 2

* Step A
* Step B
```

**Quy tắc:**
- `#` → tiêu đề file (phải ở đầu)
- `tags:` → tags của file (sau `#`) hoặc của scenario (sau `## heading`)
- `## Heading` → bắt đầu một scenario mới
- `* Step text` → một test step
- Table markdown sau step → là data của step đó
- Dòng text không có `*` → "other" type (annotation/comment)

**Setup detection:** Nếu scenario **đầu tiên** có tên chứa "set up", "setup", hoặc "global environment" → steps của nó được coi là **shared setup** (chạy trước tất cả scenarios).

---

## Ví Dụ Spec File Thực Tế

```spec
# Cash Management Available Balance

tags: VWCBT-test

* Set up global environment

* Create a new product name "cash_management" with product version ID "1" 
  using the default template parameters.

## Verify available balance check with insufficient balance

* Create a new account with the ID "CASH_MANAGEMENT" with default instance 
  parameter value on product version ID "1".

* At "2024-01-01T01:00:00", make an Inbound Hard Settlement of "20_000" "VND" 
  from internal account ID "1" to customer account ID "CASH_MANAGEMENT" 
  with parameters:

  | key                | value                          |
  | ------------------ | ------------------------------ |
  | instruction_detail | {"quantities": {"20000": "1"}} |

* At "2024-01-01T01:00:00", verify that the transaction of account ID 
  "CASH_MANAGEMENT" is rejected due to "InsufficientFunds" with contract 
  violation code "CV_006" and details:

  | key               | value |
  | ----------------- | ----- |
  | amount            | 20000 |

* Check the balances of account "CASH_MANAGEMENT" and denomination "VND" 
  with address:

  | timestamp           | address | balance |
  | ------------------- | ------- | ------- |
  | 2024-01-01T02:00:00 | DEFAULT | 0       |
```

---

## Tất Cả Loại Steps

### Config Steps

**Set timezone:**
```
* Set events time zone "Asia/Ho_Chi_Minh".
```

**Set timestamps:**
```
* Set start timestamp at "2024-01-01T00:00:00+07:00".
* Set end timestamp at "2024-12-31T23:59:59+07:00".
```

**Setup global environment:**
```
* Set up global environment
* Set up default global parameter value using parameter as default
```

---

### Product & Account Setup

**Tạo product (default params):**
```
* Create a new product name "loan" with product version ID "1" using the default template parameters.
```

**Tạo product (custom params):**
```
* Create a new product name "loan" with product version ID "1" using the specify template parameter value:

  | name                | value |
  | ------------------- | ----- |
  | minimum_loan_amount | 1000  |
```

**Tạo account (default params):**
```
* Create a new account with the ID "LOAN_ACCOUNT" with default instance parameter value on product version ID "1".
```

**Tạo account (custom params):**
```
* Create a new account with the ID "LOAN_ACCOUNT" with specify instance parameter value on product version ID "1":

  | name                | value      |
  | ------------------- | ---------- |
  | principal           | 10_000_000 |
  | loan_term           | 12         |
  | annual_interest_rate| 0.12       |
```

---

### Posting Steps

**Inbound Hard Settlement (tiền vào):**
```
* At "2024-01-01T10:00:00", make an Inbound Hard Settlement of "5_000_000" "VND" 
  from internal account ID "LOAN_INTERNAL" to customer account ID "LOAN_ACCOUNT".
```

**Outbound Hard Settlement (tiền ra):**
```
* At "2024-01-15T10:00:00", make an Outbound Hard Settlement of "1_000_000" "VND" 
  from customer account ID "LOAN_ACCOUNT" to internal account ID "LOAN_INTERNAL".
```

**Transfer:**
```
* At "2024-01-01T10:00:00", make a Transfer of "500_000" "VND" 
  from debtor account ID "ACCOUNT_A" to creditor account ID "ACCOUNT_B".
```

**Inbound Authorization (phong tỏa tiền vào):**
```
* At "2024-01-01T10:00:00", make an Inbound Authorisation of "1_000_000" "VND" 
  from internal account ID "INTERNAL" to customer account ID "ACCOUNT"
  with transaction ID "TXN_001".
```

**Outbound Authorization (phong tỏa tiền ra):**
```
* At "2024-01-01T10:00:00", make an Outbound Authorisation of "500_000" "VND" 
  from customer account ID "ACCOUNT" to internal account ID "INTERNAL"
  with client_transaction_id "TXN_001".
```

**Settlement (xác nhận authorization):**
```
* At "2024-01-02T10:00:00", make a Settlement of "500_000" with transaction ID "TXN_001".
```

**Release (hủy authorization):**
```
* At "2024-01-02T10:00:00", make a release event with transaction ID "TXN_001".
```

**Custom Instruction:**
```
* At "2024-01-01T10:00:00", initiate a Custom Instruction of "100_000" "VND" 
  of account ID "ACCOUNT" from address "DEFAULT" to address "PENDING" 
  with instruction detail:

  | key    | value |
  | ------ | ----- |
  | reason | accrual |
```

**Posting Instruction Batch — Pattern 1 ("initiate an instruction batch"):**
```
* At "2024-01-01T10:00:00", initiate an instruction batch with:

  | instruction_type       | amount    | denomination | creditor_account_id | debtor_account_id |
  | ---------------------- | --------- | ------------ | ------------------- | ----------------- |
  | InboundHardSettlement  | 1_000_000 | VND          | ACCOUNT             | INTERNAL          |
  | OutboundHardSettlement | 500_000   | VND          | INTERNAL            | ACCOUNT           |
```

**Posting Instruction Batch — Pattern 2 ("make a posting instruction batch"):**
```
* At "2024-01-01T10:00:00", make a posting instruction batch with the following posting instructions:

  | posting_type           | instruction_attribute | client_transaction_id |
  | ---------------------- | --------------------- | --------------------- |
  | InboundHardSettlement  | ...                   | TXN_001               |
```

---

### Balance Check Steps

**Single account, single denomination:**
```
* Check the balances of account "LOAN_ACCOUNT" and denomination "VND" with address:

  | timestamp           | address         | balance    |
  | ------------------- | --------------- | ---------- |
  | 2024-01-31T23:59:59 | PRINCIPAL       | 9_000_000  |
  | 2024-01-31T23:59:59 | INTEREST_DUE    | 90_000     |
  | 2024-01-31T23:59:59 | DEFAULT         | 0          |
```

**Multiple accounts/denominations:**
```
* Check the balances denomination "VND" with multiple account and address:

  | timestamp           | account_id   | address   | balance   |
  | ------------------- | ------------ | --------- | --------- |
  | 2024-01-31T23:59:59 | ACCOUNT_A    | DEFAULT   | 1_000_000 |
  | 2024-01-31T23:59:59 | ACCOUNT_B    | DEFAULT   | 500_000   |
```

---

### Verification Steps

**Accepted:**
```
* At "2024-01-01T10:00:00", verify that the transaction of account ID "LOAN_ACCOUNT" is accepted.
```

**Rejected:**
```
* At "2024-01-01T10:00:00", verify that the transaction of account ID "LOAN_ACCOUNT" is rejected 
  due to "InsufficientFunds" with reason "Available balance insufficient".
```

**Schedule verification:**
```
* At "2024-01-31T23:59:59", verify that the expected schedule of account ID "LOAN_ACCOUNT" 
  with event "REPAYMENT_DUE".
```

**Derived parameters:**
```
* At "2024-01-31T23:59:59", verify that the parameters of account ID "LOAN_ACCOUNT" should be:

  | name              | value     |
  | ----------------- | --------- |
  | available_balance | 9_000_000 |
```

**Posting instruction detail check:**
```
* At "2024-01-31T23:59:59", verify that posting instruction details contain:

  | key         | value            |
  | ----------- | ---------------- |
  | event_type  | REPAYMENT_DUE    |
  | account_id  | LOAN_ACCOUNT     |
```

---

### Account Management Steps

**Thay đổi instance params:**
```
* Change instance parameters account ID "LOAN_ACCOUNT":

  | name         | value |
  | ------------ | ----- |
  | interest_rate| 0.10  |
```

**Thay đổi template params:**
```
* Change template parameters product version ID "2":

  | name                | value |
  | ------------------- | ----- |
  | minimum_loan_amount | 500   |
```

**Update account status:**
```
* At "2024-06-01T10:00:00", update the status of account ID "LOAN_ACCOUNT" to "ACCOUNT_STATUS_CLOSED".
```

**Close account:**
```
* At "2024-06-01T10:00:00", update account status to pending closure for account ID "LOAN_ACCOUNT".
```

**Update account version:**
```
* At "2024-06-01T10:00:00", update account ID "LOAN_ACCOUNT" to product version ID "2".
```

---

### Notification Steps

**Expect notification:**
```
* At "2024-01-31T23:59:59", check if the account ID "LOAN_ACCOUNT" has notification type 
  "REPAYMENT_DUE_NOTIFICATION" with details:

  | key           | value     |
  | ------------- | --------- |
  | repayment_due | 1_090_000 |
```

**Expect no notifications:**
```
* Expect no contract notifications.
```

---

### Flag Steps

**Define flag:**
```
* At "2024-01-01T10:00:00", create a Flag Definition Event for "REPAYMENT_OVERDUE_FLAG".
```

**Set flag:**
```
* At "2024-01-01T10:00:00", set "REPAYMENT_OVERDUE_FLAG" on customer account ID "LOAN_ACCOUNT" 
  with an expiry date of "2024-12-31T23:59:59".
```

---

### Global Parameter Steps

```
* At "2024-01-01T00:00:00", create global parameter "cut_off_time" with value "23:00:00".

* Create multiple global parameter:

  | name               | value    |
  | ------------------ | -------- |
  | cut_off_time       | 23:00:00 |
  | banking_date_gap   | 1        |
```

---

## Free Text (Annotation)

Dòng text không bắt đầu bằng `* ` (và không phải heading/tags):

```
## Scenario with annotations

This is a deposit scenario to test the interest accrual feature.

* At "2024-01-01T10:00:00", make an Inbound Hard Settlement of "10_000_000" "VND"...

Verify balances after 1 month of accrual.

* Check the balances...
```

Trong diagram, annotation nodes hiện dưới dạng `// This is a deposit scenario...` với style mờ, italic.

---

## Concept Steps (.cpt files)

Files `.cpt` định nghĩa reusable step sequences:

```
# Create product and account

* Create a new product name "current_account_v2" with product version ID "1" 
  using the default template parameters.

* Create a new account with the ID "CURRENT_ACCOUNT" with default instance 
  parameter value on product version ID "1".
```

Include vào spec bằng cách reference trong spec file header.

---

## Timestamp Format

Timestamps dùng ISO 8601:
```
"2024-01-15T10:30:00"           ← no timezone (Asia/Ho_Chi_Minh assumed)
"2024-01-15T10:30:00+07:00"     ← explicit VN timezone
"2024-01-15T03:30:00Z"          ← UTC
```

---

## Amount Format

```
"10_000_000"    ← dùng _ cho readability (Gauge/Python style)
"10,000,000"    ← cũng hợp lệ (serializer sẽ normalize)
"10000000"      ← không có separator cũng ok
```

---

## Matching Response Files

Tree service map spec scenario → response file theo normalized name:

```
Scenario name: "Partial repayment during first cycle"
→ normalize: "partial_repayment_during_first_cycle"
→ matches: .gauge/simulation/loan/loan/partial_repayment_during_first_cycle.response.json
```

Normalize: lowercase, non-alphanumeric → `_`, strip leading/trailing `_`.
