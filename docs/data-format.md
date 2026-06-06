# Simulation Data Format

Gauge simulation runs produce pairs of JSON files per scenario in `.gauge/simulation/`.

## File Paths

```
.gauge/simulation/
  <product>/<group>/<scenario_name>/
    <scenario_name>.response.json    ← simulation output
    <scenario_name>.request.json     ← input events sent
```

---

## response.json Top-Level Structure

```json
{
  "result": {
    "SimulationTimestamps": { ... },
    "SmartContractSimulationResults": [ ... ]
  }
}
```

### SimulationTimestamps

```json
{
  "start": "2024-03-15T10:00:00Z",
  "end":   "2024-04-15T10:00:00Z"
}
```

---

## SmartContractSimulationResults

Array of simulation steps. Each step has:

```json
{
  "id": "...",
  "timestamp": "2024-03-15T10:05:00Z",
  "result": { ... }
}
```

The `result` field shape varies by step type.

### Posting Instruction Batch (PIB)

```json
{
  "posting_instruction_batch_id": "batch-uuid",
  "status": "POSTING_INSTRUCTION_BATCH_STATUS_ACCEPTED",
  "rejection_reason": "",
  "posting_instructions": [
    {
      "id": "pi-uuid",
      "type": "HARD_SETTLEMENT",
      "amount": "1000000",
      "denomination": "VND",
      "account_id": "LOAN_ACCOUNT",
      "account_address": "DEFAULT_ADDRESS",
      "phase": "POSTING_PHASE_COMMITTED"
    }
  ]
}
```

Status values:
- `POSTING_INSTRUCTION_BATCH_STATUS_ACCEPTED`
- `POSTING_INSTRUCTION_BATCH_STATUS_REJECTED`

### Account Update / Balance Event

```json
{
  "account_id": "LOAN_ACCOUNT",
  "balances": [
    {
      "account_address": "PRINCIPAL",
      "denomination": "VND",
      "asset": "COMMERCIAL_BANK_MONEY",
      "amount": "100000000",
      "phase": "POSTING_PHASE_COMMITTED",
      "timestamp": "2024-03-15T10:05:00Z"
    }
  ]
}
```

Special `asset` values:
- `COMMERCIAL_BANK_MONEY` — real balance
- `PRODUCT_CONFIGURATION` — account instance parameter (not monetary)

### Notification Event

```json
{
  "account_id": "LOAN_ACCOUNT",
  "notification_type": "LOAN_OVERDUE",
  "notification_details": {
    "key": "value"
  }
}
```

---

## Balances Structure (`/api/scenario-summary`)

The server builds a `balances` map keyed by `account_id`:

```json
{
  "LOAN_ACCOUNT": {
    "monetary": [
      { "address": "PRINCIPAL", "denomination": "VND", "amount": "100000000" }
    ],
    "params": [
      { "name": "principal", "value": "100000000" }
    ]
  }
}
```

Balance history is also built server-side by replaying simulation steps in order and tracking monetary balances per account, denomination, and address.

---

## PRODUCT_CONFIGURATION Balances

Steps that update `asset: "PRODUCT_CONFIGURATION"` represent instance parameter values, not monetary amounts. They appear in the Accounts tab under "Instance Parameters" separate from monetary balances.

Example:
```json
{
  "account_address": "principal",
  "denomination": "VND",
  "asset": "PRODUCT_CONFIGURATION",
  "amount": "100000000"
}
```

This means the account parameter `principal` is set to `100000000`.

---

## request.json Top-Level Structure

Contains the events sent to the simulation engine — posting instructions, account creation requests, etc. Used for cross-referencing inputs. Structure mirrors the gRPC request proto.

```json
{
  "simulation_start_timestamp": "2024-03-15T10:00:00Z",
  "simulation_end_timestamp":   "2024-04-15T10:00:00Z",
  "smart_contract_files": [ ... ],
  "events": [ ... ]
}
```
