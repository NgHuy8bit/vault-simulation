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

    for line_num, line in enumerate(content.splitlines(), start=1):
        if line.startswith("# ") and not line.startswith("## "):
            if current_step is not None:
                _trim_trailing_blank_source(current_step)
            title = line[2:].strip()
            continue

        if line.startswith("## "):
            if current_step is not None:
                _trim_trailing_blank_source(current_step)
            current = {"name": line[3:].strip(), "tags": [], "raw_steps": [], "_line": line_num}
            current_step = None
            scenarios.append(current)
            continue

        stripped = line.strip()
        if stripped.startswith("tags:"):
            if current_step is not None:
                _trim_trailing_blank_source(current_step)
            tags = [tag.strip() for tag in stripped[5:].split(",") if tag.strip()]
            if current is None:
                file_tags = tags
            else:
                current["tags"] = tags
        elif line.startswith("* "):
            if current_step is not None:
                _trim_trailing_blank_source(current_step)
            current_step = {"text": line[2:].strip(), "table_rows": [], "source_lines": [line], "_line": line_num}
            target_steps().append(current_step)
        elif stripped.startswith("|") and current_step is not None and not current_step.get("free_text"):
            current_step["table_rows"].append(stripped)
            current_step.setdefault("source_lines", []).append(line)
        elif stripped == "" and current_step is not None:
            current_step.setdefault("source_lines", []).append(line)
        elif stripped and not stripped.startswith("#"):
            # Free-text annotation line — merge into existing free-text block or start new one.
            # Merging preserves blank lines between consecutive free-text lines via source_lines.
            if current_step is not None and not current_step.get("free_text"):
                _trim_trailing_blank_source(current_step)
                current_step = None
            if current_step is not None and current_step.get("free_text"):
                current_step["source_lines"].append(line)
            else:
                free_step = {"text": "", "table_rows": [], "free_text": stripped, "source_lines": [line]}
                target_steps().append(free_step)
                current_step = free_step

    def _parse_raw_step(step: dict[str, Any]) -> dict[str, Any]:
        _trim_trailing_blank_source(step)
        source_lines = step.get("source_lines") or []
        if step.get("free_text"):
            return {
                "type": "other",
                "raw": "",
                "line": step.get("_line"),
                "data": {
                    "raw_text": step["free_text"],
                    "is_free_text": True,
                    "_source_lines": source_lines,
                },
            }
        parsed_step = _parse_step(step["text"], step["table_rows"])
        parsed_step.setdefault("data", {})["_source_lines"] = source_lines
        parsed_step["line"] = step.get("_line")
        return parsed_step

    parsed_scenarios = [
        {
            "name": scenario["name"],
            "tags": scenario["tags"],
            "line": scenario.get("_line"),
            "steps": [_parse_raw_step(step) for step in scenario["raw_steps"]],
        }
        for scenario in scenarios
    ]

    setup_steps = [_parse_raw_step(step) for step in setup_raw]
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


def _trim_trailing_blank_source(step: dict[str, Any]) -> None:
    source_lines = step.get("source_lines")
    if not source_lines:
        return
    while source_lines and not source_lines[-1].strip():
        source_lines.pop()


def _classify_step(text: str) -> str:
    lowered = text.lower()

    # Setup
    if "create a new product" in lowered:
        return "product"
    if "create a new account" in lowered:
        return "account"

    # Notifications
    if "expect no contract notifications" in lowered:
        return "no_notifications"
    if re.search(r"check if the account id .* notification type", lowered):
        return "notification"

    # Config / time zone
    if re.search(r"set (events time zone|start timestamp|end timestamp|up default|.*time zone)", lowered):
        return "config"
    if re.search(r"set up (global environment|.*using parameter as default|default global parameter)", lowered):
        return "config"

    # Hard settlements (before generic inbound/outbound)
    if "outbound hard settlement" in lowered:
        return "outbound"
    if "inbound hard settlement" in lowered:
        return "inbound"

    # Authorisations / Authorizations (both "make" and "initiate" forms)
    if re.search(r"outbound authori[sz]", lowered):
        return "outbound_auth"
    if re.search(r"inbound authori[sz]", lowered):
        return "inbound_auth"

    # Auth adjustment (before transfer to avoid collision)
    if "auth adjustment" in lowered:
        return "auth_adjustment"

    # Transfer (both "make" and "initiate" forms)
    if re.search(r"(make|initiate) a.? transfer", lowered):
        return "transfer"

    # Settlement — two forms
    if re.search(r"make a settlement", lowered) or "settle the transaction" in lowered:
        return "settlement"

    # Release — two forms
    if "make a release event" in lowered or "release the transaction" in lowered:
        return "release"

    # Custom instruction
    if "custom instruction" in lowered:
        return "custom_instruction"

    # Posting instruction batch — two forms
    if re.search(r"(make|initiate) a.? (posting instruction batch|instruction batch)", lowered):
        return "posting_instruction_batch"

    # Balance checks
    if re.search(r"check the balances denomination|check the balances with address and denomination", lowered):
        return "balance_check_multi"
    if re.search(r"check (the balances|if the balance)", lowered):
        return "balance_check"

    # Schedule
    if re.search(r"verify.*expected schedule", lowered):
        return "schedule"

    # Parameter checks — more specific first
    if re.search(r"verify that the parameter change.*rejected", lowered):
        return "parameter_rejected"
    if re.search(r"verify that the parameters of account", lowered):
        return "derived_parameters"
    if re.search(r"verify that the parameter .+ of account", lowered):
        return "derived_parameter_dict"

    # Parameter changes
    if "change instance parameters" in lowered or re.search(r"change instance parameter\b", lowered):
        return "change_instance_params"
    if "change template parameters" in lowered:
        return "change_template_params"

    # Account management — more specific first
    if "update the status of account" in lowered:
        return "update_account_status"
    if "update account status to pending closure" in lowered:
        return "account_close"
    if re.search(r"update account id .+ to product version id", lowered):
        return "update_account_version"
    if "assert an exception when closed account" in lowered:
        return "exception_msg"

    # Flags
    if "create a flag definition event" in lowered:
        return "flag_definition"
    if re.search(r"set .+ on customer account id", lowered):
        return "flag"

    # Global parameters
    if re.search(r"(create|init|change) (multiple )?global parameter", lowered):
        return "global_param"

    # Instruction / batch detail checks (before generic verify/check)
    if re.search(r"verify.*posting instruction detail", lowered):
        return "instruction_detail_check"
    if re.search(r"verify.*gl information.*instruction detail", lowered):
        return "instruction_detail_check"
    if re.search(r"check batch det", lowered):
        return "batch_detail_check"

    # Transaction / posting verification
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
    elif step_type == "balance_check_multi":
        data = _parse_balance_check_multi(text, table)
    elif step_type in ("inbound", "outbound"):
        data = _parse_hard_settlement(text, table, inbound=(step_type == "inbound"))
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
    elif step_type == "auth_adjustment":
        amount = re.search(r'auth adjustment "([^"]+)"', text)
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "amount": _clean_amount(amount.group(1) if amount else "0"),
            "client_transaction_id": _first(r'client transaction ID "([^"]+)"', text),
        }
    elif step_type == "accepted":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
        }
    elif step_type == "rejected":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "rejection_type": _first(r'rejected due to "([^"]+)"', text, "AgainstTermsAndConditions"),
            "rejection_reason": _first(r'with reason "([^"]+)"', text),
        }
    elif step_type == "notification":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "notification_type": _first(r'notification type "([^"]+)"', text),
            "notification_details": _key_value_rows(table),
            "expected": "has no notification type" not in text.lower(),
        }
    elif step_type == "no_notifications":
        data = {}
    elif step_type == "schedule":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "event_id": _first(r'event "([^"]+)"', text),
        }
    elif step_type == "parameter_rejected":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "rejection_type": _first(r'rejected due to "([^"]+)"', text, "AgainstTermsAndConditions"),
            "rejection_reason": _first(r'with reason "([^"]+)"', text),
        }
    elif step_type == "derived_parameters":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "rows": [{"name": r.get("name", ""), "value": r.get("value", "")} for r in table],
        }
    elif step_type == "derived_parameter_dict":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "param_name": _first(r'parameter "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "rows": [{"key": r.get("key", ""), "value": r.get("value", "")} for r in table],
        }
    elif step_type == "change_instance_params":
        data = {
            "account_id": _first(r'(?:account ID|of) "([^"]+)"', text),
            "params": _name_value_rows(table),
        }
    elif step_type == "change_template_params":
        data = {
            "product_version_id": _first(r'product version ID "([^"]+)"', text),
            "params": _name_value_rows(table),
        }
    elif step_type == "update_account_status":
        # "At <timestamp>, update the status of account ID <account_id> to <status>."
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "status": _first(r'\bto "([^"]+)"', text),
        }
    elif step_type == "account_close":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
        }
    elif step_type == "update_account_version":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "product_version_id": _first(r'product version ID "([^"]+)"', text),
        }
    elif step_type == "exception_msg":
        data = {"message": _first(r'with message "([^"]+)"', text)}
    elif step_type == "flag_definition":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "flag_name": _first(r'for "([^"]+)"', text),
        }
    elif step_type == "flag":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "flag_name": _first(r'set "([^"]+)"', text),
            "account_id": _first(r'account ID "([^"]+)"', text),
            "expiry_timestamp": _first(r'expiry date of "([^"]+)"', text),
        }
    elif step_type == "global_param":
        # Try to extract structured fields; fall back to raw
        name = (_first(r'parameter ID "([^"]+)"', text)
                or _first(r'parameter "([^"]+)"', text)
                or _first(r'global parameter (\S+)', text))
        value = _first(r'value "([^"]+)"', text) or _first(r'\bvalue\b\s+"([^"]+)"', text)
        timestamp = _first(r'At "([^"]+)"', text) or _first(r'start "([^"]+)"', text)
        data = {"timestamp": timestamp, "name": name, "value": value, "rows": table, "raw_text": text if not table else None}
    elif step_type == "instruction_detail_check":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "rows": table,
        }
    elif step_type == "batch_detail_check":
        data = {
            "timestamp": _first(r'At "([^"]+)"', text),
            "rows": table,
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


# ── Balance checks ────────────────────────────────────────────────────────────

def _parse_balance_check(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    account_id = _first(r'account "([^"]+)"', text)
    denomination = _first(r'denomination "([^"]+)"', text, "VND")
    rows = []
    for row in table:
        rows.append({
            "timestamp": row.get("timestamp", _first(r'At "([^"]+)"', text)),
            "account_id": row.get("account_id", account_id),
            "address": row.get("address", ""),
            "denomination": row.get("denomination", denomination),
            "phase": row.get("phase", "POSTING_PHASE_COMMITTED"),
            "asset": row.get("asset", "COMMERCIAL_BANK_MONEY"),
            "balance": row.get("balance", "0"),
        })
    rows.sort(key=lambda item: item.get("timestamp", ""))
    return {"denomination": denomination, "rows": rows}


def _parse_balance_check_multi(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    denomination = _first(r'denomination "([^"]+)"', text, "VND")
    rows = []
    for row in table:
        rows.append({
            "timestamp": row.get("timestamp", ""),
            "account_id": row.get("account_id", ""),
            "address": row.get("address", ""),
            "denomination": row.get("denomination", denomination),
            "phase": row.get("phase", "POSTING_PHASE_COMMITTED"),
            "asset": row.get("asset", "COMMERCIAL_BANK_MONEY"),
            "balance": row.get("balance", "0"),
        })
    rows.sort(key=lambda item: item.get("timestamp", ""))
    return {"denomination": denomination, "rows": rows}


# ── Inbound / Outbound Hard Settlement ───────────────────────────────────────
# Inbound:  "make an Inbound Hard Settlement ... from internal account ID X to customer account ID Y"
# Outbound: "make an Outbound Hard Settlement ... from customer account ID X to internal account ID Y"

def _parse_hard_settlement(text: str, table: list[dict[str, str]], inbound: bool) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    if inbound:
        from_account = _first(r'from internal account ID "([^"]+)"', text)
        to_account = _first(r'to customer account ID "([^"]+)"', text)
    else:
        from_account = _first(r'from customer account ID "([^"]+)"', text)
        to_account = _first(r'to internal account ID "([^"]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "from_account": from_account,
        "to_account": to_account,
        "instruction_detail": _key_value_rows(table),
    }


# ── Inbound Authorisation ─────────────────────────────────────────────────────
# Step: "make an Inbound Authorisation of <amount> <denom>
#        from internal account ID <internal_account_id> to customer account ID <customer_account_id>."

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
# Step: "make an Outbound Authorisation of <amount> <denom>
#        from customer account ID <customer_account_id> to internal account ID <internal_account_id>."

def _parse_outbound_auth(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "customer_account_id": _first(r'from customer account ID "([^"]+)"', text),
        "internal_account_id": _first(r'to internal account ID "([^"]+)"', text),
        "client_transaction_id": _first(r'with (?:transaction ID|client_transaction_id) "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Transfer ──────────────────────────────────────────────────────────────────
# Step: "make a Transfer of <amount> <denom>
#        from debtor account ID <debtor_account_id> to creditor account ID <creditor_account_id>."

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
# Step (steps/simulation): "make a Settlement of <amount> with transaction ID <client_transaction_id>."
# Step (tests/framework):  "settle the transaction with and amount of <amount>
#                           and client transaction ID <client_transaction_id>."

def _parse_settlement_instruction(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    amount = (
        re.search(r'amount of "([^"]+)"', text)
        or re.search(r'Settlement of "([^"]+)"', text)
    )
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "client_transaction_id": _first(r'(?:transaction ID|client transaction ID) "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Release Event ─────────────────────────────────────────────────────────────
# Step (steps/simulation): "make a release event with transaction ID <client_transaction_id>."
# Step (tests/framework):  "release the transaction with client transaction ID <client_transaction_id>."

def _parse_release(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "client_transaction_id": _first(r'(?:transaction ID|client transaction ID) "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Custom Instruction ────────────────────────────────────────────────────────

def _parse_custom_instruction(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    # Actual spec format (confirmed from specs in the wild):
    #   At "<ts>", initiate a Custom Instruction of "<amount>" "<denom>"
    #   of account ID "<account_id>"
    #   from address "<from_address>" to address "<to_address>"
    #   with instruction detail:  [table]
    amount = re.search(r'"([\d_,.]+)"\s+"([A-Z]+)"', text)
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "amount": _clean_amount(amount.group(1) if amount else "0"),
        "denomination": amount.group(2) if amount else "VND",
        "account_id": _first(r'account ID "([^"]+)"', text),
        "from_address": _first(r'from address "([^"]+)"', text),
        "to_address": _first(r'to address "([^"]+)"', text),
        "instruction_detail": _key_value_rows(table),
    }


# ── Posting Instruction Batch ─────────────────────────────────────────────────

def _parse_posting_instruction_batch(text: str, table: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "timestamp": _first(r'At "([^"]+)"', text),
        "instructions": table,
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
