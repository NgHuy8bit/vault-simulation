# Gauge Spec Syntax Reference

This project uses the [Gauge](https://gauge.org/) test framework with custom Vault step implementations.

## File Structure

```
# Spec Title

tags: tag1, tag2

## File-level Setup Steps (run before every scenario)

* Step that applies to all scenarios.

## Scenario Name

tags: AC-1

* Scenario-specific step.
```

- `#` = spec title (one per file)
- `##` = scenario heading
- `tags:` line = comma-separated tags (can appear at spec or scenario level)
- `*` = step (Gauge step, mapped to Go/Python implementation)
- Blank `## <Name>` section at top = **file-level setup** (no `tags:` line) — runs before every scenario

## Step Reference

### Configuration Steps

```gauge
* Set events time zone "Asia/Ho_Chi_Minh".
* Set start timestamp at "2024-03-15T10:00:00".
* Set up default global parameter value for loan account
```

- Timestamp format: `ISO 8601` without timezone — interpreted as UTC by the simulation engine
- Period `.` at end of step text is required for configuration steps

### Product Setup

```gauge
* Create a new product name "loan" with product version ID "1" using the default template parameters.
```

### Account Creation

```gauge
* Create a new account with the ID "LOAN_ACCOUNT" with specify instance parameter value on product version ID "1":

  | name                | value     |
  | ------------------- | --------- |
  | principal           | 100000000 |
  | interest_rate_tiers | 0.12      |
```

- Account ID convention: `SCREAMING_SNAKE_CASE`
- Internal/contra accounts: `DEPOSIT_ACCOUNT`, `ACCRUED_INTEREST_RECEIVABLE`, etc.

### Inbound Hard Settlement (customer deposits / loan disbursements)

```gauge
* At "2024-03-15T10:00:00", make an Inbound Hard Settlement of "1_000_000" "VND" from internal account ID "DEPOSIT_ACCOUNT" to customer account ID "LOAN_ACCOUNT" with parameters:

  | key           | value             |
  | ------------- | ----------------- |
  | posting_event | DISBURSEMENT      |
```

- Amount can use `_` as thousands separator for readability
- `instruction detail` table keys depend on product (e.g. `posting_event`, `note`)

### Outbound Hard Settlement (repayments / withdrawals)

```gauge
* At "2024-03-15T10:00:00", make an Outbound Hard Settlement of "1_000_000" "VND" from customer account ID "LOAN_ACCOUNT" to internal account ID "DEPOSIT_ACCOUNT" with parameters:

  | key           | value             |
  | ------------- | ----------------- |
  | posting_event | REPAYMENT         |
```

### Verify Transaction Accepted

```gauge
* At "2024-03-15T10:00:00", verify that the transaction of account ID "LOAN_ACCOUNT" is accepted.
```

### Verify Transaction Rejected

```gauge
* At "2024-03-15T10:00:00", verify that the transaction of account ID "LOAN_ACCOUNT" is rejected due to "AgainstTermsAndConditions" with contract violation code "CV_006" and details:

  | key         | value                |
  | ----------- | -------------------- |
  | reason_text | Exceeds credit limit |
```

Common rejection reason values:
- `AgainstTermsAndConditions`
- `InsufficientFunds`
- `Unknown`
- `Other`

### Balance Check

```gauge
* Check the balances with address and denomination:

  | timestamp           | account_id   | address          | denomination | phase                   | asset                 | balance   |
  | ------------------- | ------------ | ---------------- | ------------ | ----------------------- | --------------------- | --------- |
  | 2024-03-15T11:00:00 | LOAN_ACCOUNT | PRINCIPAL        | VND          | POSTING_PHASE_COMMITTED | COMMERCIAL_BANK_MONEY | 100000000 |
  | 2024-03-15T11:00:00 | LOAN_ACCOUNT | ACCRUED_INTEREST | VND          | POSTING_PHASE_COMMITTED | COMMERCIAL_BANK_MONEY | 0         |
```

- `timestamp`: point in simulation time to check (UTC, no timezone suffix)
- `address`: balance address / dimension (product-specific)
- `balance`: expected amount as integer (no decimals for VND)
- Multiple rows = multiple assertions; rows should be in ascending timestamp order

## Common Balance Addresses

| Address | Meaning |
|---------|---------|
| `PRINCIPAL` | Outstanding loan principal |
| `ACCRUED_INTEREST` | Accrued but not yet due interest |
| `INTEREST_DUE` | Interest billed and due |
| `PRINCIPAL_DUE` | Principal installment due |
| `PENALTIES` | Penalty charges |
| `INTERNAL_CONTRA` | Double-entry contra (always ~equal but negative) |
| `DEFAULT_ADDRESS` | Default catch-all address |

## Table Formatting Rules

- Gauge tables use `|` delimiters with header separator row of `-` characters
- Column widths are flexible (padding is cosmetic only)
- Table must be indented with 2 spaces inside a step block
- Empty cells must be explicit: `|  |`

## File Naming Convention

```
specs/
  <product>/
    <scenario_group>/
      <specific_test>.spec
```

Example: `specs/loan/repayment/early_termination.spec`

The simulation viewer maps `.response.json` output path → spec file by stripping the scenario subfolder:
`loan/repayment/early_termination/<scenario>.response.json` → `specs/loan/repayment/early_termination.spec`

## Full Example File

```gauge
# Early Termination

tags: loan, repayment

## Set up global environment

* Set events time zone "Asia/Ho_Chi_Minh".
* Set start timestamp at "2024-03-15T10:00:00".
* Set up default global parameter value for loan account
* Create a new product name "loan" with product version ID "1" using the default template parameters.

## Scenario: Full repayment before maturity

tags: AC-1

* Create a new account with the ID "LOAN_ACCOUNT" with specify instance parameter value on product version ID "1":

  | name      | value     |
  | --------- | --------- |
  | principal | 100000000 |

* At "2024-03-15T10:00:00", make an Inbound Hard Settlement of "100_000_000" "VND" from internal account ID "DEPOSIT_ACCOUNT" to customer account ID "LOAN_ACCOUNT" with parameters:

  | key           | value        |
  | ------------- | ------------ |
  | posting_event | DISBURSEMENT |

* At "2024-03-15T10:00:00", verify that the transaction of account ID "LOAN_ACCOUNT" is accepted.

* Check the balances of account "LOAN_ACCOUNT" and denomination "VND" with address:

  | timestamp           | address   | balance   |
  | ------------------- | --------- | --------- |
  | 2024-03-15T10:00:00 | PRINCIPAL | 100000000 |

* At "2024-04-15T10:00:00", make an Outbound Hard Settlement of "100_000_000" "VND" from customer account ID "LOAN_ACCOUNT" to internal account ID "DEPOSIT_ACCOUNT" with parameters:

  | key           | value      |
  | ------------- | ---------- |
  | posting_event | REPAYMENT  |

* At "2024-04-15T10:00:00", verify that the transaction of account ID "LOAN_ACCOUNT" is accepted.
```
