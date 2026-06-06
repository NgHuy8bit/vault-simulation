from __future__ import annotations

import re
from typing import Any


def parse_spec_content(content: str) -> dict[str, Any]:
    title = ""
    file_tags: list[str] = []
    setup_raw: list[dict[str, Any]] = []
    scenarios: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_step: dict[str, Any] | None = None

    def target_steps() -> list[dict[str, Any]]:
        return current["raw_steps"] if current is not None else setup_raw

    for line in content.splitlines():
        if line.startswith("# ") and not line.startswith("## "):
            title = line[2:].strip()
            continue

        if line.startswith("## "):
            current = {"name": line[3:].strip(), "tags": [], "raw_steps": []}
            current_step = None
            scenarios.append(current)
            continue

        stripped = line.strip()
        if stripped.startswith("tags:"):
            tags = [tag.strip() for tag in stripped[5:].split(",") if tag.strip()]
            if current is None:
                file_tags = tags
            else:
                current["tags"] = tags
        elif line.startswith("* "):
            current_step = {"text": line[2:].strip(), "table_rows": []}
            target_steps().append(current_step)
        elif stripped.startswith("|") and current_step is not None:
            current_step["table_rows"].append(stripped)

    parsed_scenarios = [
        {
            "name": scenario["name"],
            "tags": scenario["tags"],
            "steps": [_parse_step(step["text"], step["table_rows"]) for step in scenario["raw_steps"]],
        }
        for scenario in scenarios
    ]

    setup_steps = [_parse_step(step["text"], step["table_rows"]) for step in setup_raw]
    scenario_list = parsed_scenarios
    if len(parsed_scenarios) > 1:
        first = parsed_scenarios[0]
        first_name = first["name"].lower()
        if "set up" in first_name or "setup" in first_name or "global environment" in first_name:
            setup_steps.extend(first["steps"])
            scenario_list = parsed_scenarios[1:]

    return {
        "title": title,
        "file_tags": file_tags,
        "setup_steps": setup_steps,
        "scenarios": scenario_list,
    }


def _classify_step(text: str) -> str:
    lowered = text.lower()
    if "create a new product" in lowered:
        return "product"
    if "create a new account" in lowered:
        return "account"
    if re.search(r"check if the account id .*notification", lowered):
        return "notification"
    if re.search(r"set (events time zone|start timestamp|end timestamp|up default|.*time zone)", lowered):
        return "config"
    if re.search(r"set up (global environment|.*using parameter as default|default global parameter)", lowered):
        return "config"
    if "check the balances" in lowered or "check if the balance" in lowered:
        return "balance_check"
    # Hard settlements (must come before generic "outbound" / "inbound" checks)
    if "outbound hard settlement" in lowered:
        return "outbound"
    if "inbound hard settlement" in lowered:
        return "inbound"
    # Authorisations
    if "outbound authorisation" in lowered:
        return "outbound_auth"
    if "inbound authorisation" in lowered:
        return "inbound_auth"
    # Transfer
    if re.search(r"make a transfer", lowered):
        return "transfer"
    # Settlement
    if re.search(r"make a settlement", lowered):
        return "settlement"
    # Release
    if re.search(r"make a release event", lowered):
        return "release"
    # Custom instruction
    if re.search(r"make a custom instruction", lowered):
        return "custom_instruction"
    # Posting instruction batch
    if re.search(r"make a posting instruction batch|make multiple posting instruction batches|make a buffer posting", lowered):
        return "posting_instruction_batch"
    if re.search(r"verify.*\baccepted\b", lowered):
        return "accepted"
    if re.search(r"verify.*\brejected\b", lowered):
        return "rejected"
    return "other"


def _parse_step(text: str, table_rows: list[str]) -> dict[str, Any]:
    step_type = _classify_step(text)
    table = _parse_table(table_rows)

    if step_type == "config":
        data = _parse_config(text)
    elif step_type == "product":
        data = {
            "name": _first(r'product name "([^"]+)"', text),
            "version_id": _first(r'product version ID "([^"]+)"', text, "1"),
            "params": _name_value_rows(table),
            "template_mode": "specify" if table else "default",
        }
    elif step_type == "account":
        data = {
            "account_id": _first(r'account with the ID "([^"]+)"', text),
            "version_id": _first(r'product version ID "([^"]+)"', text, "1"),
            "params": _name_value_rows(table),
            "parameter_values": _parameter_value_rows(table),
            "account_param_mode": "parameter_values"
            if "specify parameter values" in text.lower()
            else ("instance_params" if table else "default"),
        }
    elif step_type == "balance_check":
        data = _parse_balance_check(text, table)
    elif step_type in ("inbound", "outbound"):
        data = _parse_settlement(text, table)
    elif step_type == "inbound_auth":
        data = _parse_inbound_auth(text, table)
    elif step_type == "outbound_auth":
        data = _parse_outbound_auth(text, table)
    elif step_type == "transfer":
        data = _parse_transfer(text, table)
    elif step_type == "settlement":
        data = _parse_settlement_instruction(text, table)
    elif step_type == "release":
        data = _parse_release(text, table)
    elif step_type == "custom_instruction":
        data = _parse_custom_instruction(text, table)
    elif step_type == "posting_instruction_batch":
        data = _parse_posting_instruction_batch(text, table)
    elif step_type == "accepted":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
        }
    elif step_type == "rejected":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "reason_code": _first(r'rejected due to "([^"]+)"', text, "AgainstTermsAndConditions"),
            "contract_violation_code": _first(r'contract violation code "([^"]+)"', text),
            "reason_text": _reason_text(table),
            "details": _key_value_rows(table),
        }
    elif step_type == "notification":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "notification_type": _first(r'notification type "([^"]+)"', text),
            "notification_details": _key_value_rows(table),
            "expected": "has no notification type" not in text.lower(),
        }
    else:
        data = {"raw_text": text}

    return {"type": step_type, "raw": text, "data": data}


# ── Config ────────────────────────────────────────────────────────────────────

def _parse_config(text: str) -> dict[str, str]:
    timezone = _first(r'time zone "([^"]+)"', text)
    start = _first(r'start timestamp at "([^"]+)"', text)
    end = _first(r'end timestamp at "([^"]+)"', text)
    if timezone:
        return {"key": "timezone", "value": timezone}
    if start:
        return {"key": "start_timestamp", "value": start}
    if end:
        return {"key": "end_timestamp", "value": end}
    return {"key": "global_param", "value": text}


# ── Balance check ─────────────────────────────────────────────────────────────

def _parse_balance_check(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    account_id = _first(r'account "([^"]+)"', text)
    denomination = _first(r'denomination "([^"]+)"', text, "VND")
    rows = []
    for row in table:
        rows.append(
            {
                "timestamp": row.get("timestamp", _first(r'At "([^"]+)"', text)),
                "account_id": row.get("account_id", account_id),
                "address": row.get("address", ""),
                "denomination": row.get("denomination", denomination),
                "phase": row.get("phase", "POSTING_PHASE_COMMITTED"),
                "asset": row.get("asset", "COMMERCIAL_BANK_MONEY"),
                "balance": _clean_amount(row.get("balance", "0")),
            }
        )
    rows.sort(key=lambda item: item.get("timestamp", ""))
    return {"denomination": denomination, "rows": rows}


# ── Inbound / Outbound Hard Settlement ───────────────────────────────────────

def _parse_settlement(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "from_account": _first(r'from (?:internal |customer )?account ID "([^"]+)"', text),
        "to_account": _first(r'to (?:customer |internal )?account ID "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Inbound Authorisation ─────────────────────────────────────────────────────

def _parse_inbound_auth(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "internal_account_id": _first(r'from internal account ID "([^"]+)"', text),
        "customer_account_id": _first(r'to customer account ID "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Outbound Authorisation ────────────────────────────────────────────────────

def _parse_outbound_auth(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "customer_account_id": _first(r'from customer account ID "([^"]+)"', text),
        "internal_account_id": _first(r'to internal account ID "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Transfer ──────────────────────────────────────────────────────────────────

def _parse_transfer(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "debtor_account_id": _first(r'from debtor account ID "([^"]+)"', text),
        "creditor_account_id": _first(r'to creditor account ID "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Settlement (posting instruction) ─────────────────────────────────────────

def _parse_settlement_instruction(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "client_transaction_id": _first(r'transaction ID "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Release Event ─────────────────────────────────────────────────────────────

def _parse_release(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "client_transaction_id": _first(r'transaction ID "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Custom Instruction ────────────────────────────────────────────────────────

def _parse_custom_instruction(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "debtor_account_id": _first(r'from debtor account ID "([^"]+)"', text),
        "debtor_account_address": _first(r'debtor account ID "[^"]+" with address "([^"]+)"', text),
        "creditor_account_id": _first(r'to creditor account ID "([^"]+)"', text),
        "creditor_account_address": _first(r'creditor account ID "[^"]+" with address "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Posting Instruction Batch ─────────────────────────────────────────────────

def _parse_posting_instruction_batch(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "instructions": table,  # raw table rows preserved
        "raw_text": text,
    }


# ── Table helpers ─────────────────────────────────────────────────────────────

def _parse_table(rows: list[str]) -> list[dict[str, str]]:
    if not rows:
        return []

    header = _parse_table_row(rows[0])
    parsed: list[dict[str, str]] = []
    for row in rows[1:]:
        if re.match(r"^[\|\s\-:]+$", row):
            continue
        cells = _parse_table_row(row)
        while len(cells) < len(header):
            cells.append("")
        parsed.append(dict(zip(header, cells[: len(header)])))
    return parsed


def _parse_table_row(row: str) -> list[str]:
    return [cell.strip() for cell in row.strip().strip("|").split("|")]


def _first(pattern: str, text: str, default: str = "") -> str:
    match = re.search(pattern, text, re.IGNORECASE)
    return match.group(1) if match else default


def _clean_amount(value: str) -> str:
    return str(value or "0").replace("_", "").replace(",", "")


def _key_value_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{"key": row.get("key", ""), "value": row.get("value", "")} for row in rows]


def _name_value_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{"name": row.get("name", ""), "value": row.get("value", "")} for row in rows]


def _parameter_value_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {
            "name": row.get("name", ""),
            "constraint": row.get("constraint", ""),
            "value": row.get("value", ""),
        }
        for row in rows
        if "constraint" in row
    ]


def _reason_text(rows: list[dict[str, str]]) -> str:
    for row in rows:
        key = row.get("key", "").lower()
        if key in {"reason", "reason_text", "message", "description"}:
            return row.get("value", "")
    return ""
