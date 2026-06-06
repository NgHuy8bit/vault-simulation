from typing import Any


def serialize_spec(spec_data: dict[str, Any]) -> str:
    lines = [f'# {spec_data.get("title") or "New Spec"}', ""]

    file_tags = spec_data.get("file_tags") or []
    if file_tags:
        lines.extend(["tags: " + ", ".join(file_tags), ""])

    for step in spec_data.get("setup_steps") or []:
        lines.extend(_serialize_step(step))
        lines.append("")

    for scenario in spec_data.get("scenarios") or []:
        lines.extend([f'## {scenario.get("name") or "Scenario"}', ""])
        tags = scenario.get("tags") or []
        if tags:
            lines.extend(["tags: " + ", ".join(tags), ""])
        for step in scenario.get("steps") or []:
            lines.extend(_serialize_step(step))
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _serialize_step(step: dict[str, Any]) -> list[str]:
    step_type = step.get("type", "other")
    data = step.get("data") or {}

    if step_type == "config":
        return [_serialize_config(data)]
    if step_type == "product":
        return _serialize_product(data)
    if step_type == "account":
        return _serialize_account(data)
    if step_type == "balance_check":
        return _serialize_balance_check(data)
    if step_type == "inbound":
        return _serialize_hard_settlement(data, inbound=True)
    if step_type == "outbound":
        return _serialize_hard_settlement(data, inbound=False)
    if step_type == "inbound_auth":
        return _serialize_inbound_auth(data)
    if step_type == "outbound_auth":
        return _serialize_outbound_auth(data)
    if step_type == "transfer":
        return _serialize_transfer(data)
    if step_type == "settlement":
        return _serialize_settlement_instruction(data)
    if step_type == "release":
        return _serialize_release(data)
    if step_type == "custom_instruction":
        return _serialize_custom_instruction(data)
    if step_type == "posting_instruction_batch":
        return _serialize_posting_instruction_batch(data)
    if step_type == "accepted":
        return [
            f'* At "{data.get("timestamp", "")}", verify that the transaction of '
            f'account ID "{data.get("account_id", "")}" is accepted.'
        ]
    if step_type == "rejected":
        return _serialize_rejected(data)
    if step_type == "notification":
        return _serialize_notification(data)

    raw = step.get("raw") or data.get("raw_text") or ""
    return [raw if raw.startswith("* ") else f"* {raw}"] if raw else []


# ── Config ─────────────────────────────────────────────────────────────────────

def _serialize_config(data: dict[str, Any]) -> str:
    key = data.get("key")
    value = data.get("value", "")
    if key == "timezone":
        return f'* Set events time zone "{value}".'
    if key == "start_timestamp":
        return f'* Set start timestamp at "{value}".'
    if key == "end_timestamp":
        return f'* Set end timestamp at "{value}".'
    text = value or "Set up global environment"
    return text if text.startswith("* ") else f"* {text}"


# ── Product ────────────────────────────────────────────────────────────────────

def _serialize_product(data: dict[str, Any]) -> list[str]:
    name = data.get("name") or "loan"
    version_id = data.get("version_id") or "1"
    params = data.get("params") or []
    if params:
        return [
            f'* Create a new product name "{name}" with product version ID "{version_id}" '
            "using the specify template parameter value:",
            "",
            _format_table(["name", "value"], params),
        ]
    return [
        f'* Create a new product name "{name}" with product version ID "{version_id}" '
        "using the default template parameters."
    ]


# ── Account ────────────────────────────────────────────────────────────────────

def _serialize_account(data: dict[str, Any]) -> list[str]:
    account_id = data.get("account_id") or "ACCOUNT"
    version_id = data.get("version_id") or "1"
    param_mode = data.get("account_param_mode") or "instance_params"
    parameter_values = data.get("parameter_values") or []
    params = data.get("params") or []

    if param_mode == "parameter_values" and parameter_values:
        return [
            f'* Create a new account with the ID "{account_id}" with specify parameter values '
            f'on product version ID "{version_id}":',
            "",
            _format_table(["name", "constraint", "value"], parameter_values),
        ]

    if params:
        return [
            f'* Create a new account with the ID "{account_id}" with specify instance parameter value '
            f'on product version ID "{version_id}":',
            "",
            _format_table(["name", "value"], params),
        ]

    return [
        f'* Create a new account with the ID "{account_id}" with default instance parameter value '
        f'on product version ID "{version_id}".'
    ]


# ── Balance check ───────────────────────────────────────────────────────────────

def _serialize_balance_check(data: dict[str, Any]) -> list[str]:
    rows = sorted(data.get("rows") or [], key=lambda row: row.get("timestamp", ""))
    denomination = data.get("denomination") or (rows[0].get("denomination") if rows else "VND")
    account_ids = {row.get("account_id", "") for row in rows}

    if len(account_ids) == 1 and "" not in account_ids:
        account_id = next(iter(account_ids))
        compact_rows = [
            {
                "timestamp": row.get("timestamp", ""),
                "address": row.get("address", ""),
                "balance": row.get("balance", "0"),
                **({("phase"): row.get("phase")} if row.get("phase") else {}),
            }
            for row in rows
        ]
        headers = ["timestamp", "address", "balance"]
        if any(row.get("phase") for row in compact_rows):
            headers.append("phase")
        return [
            f'* Check the balances of account "{account_id}" and denomination "{denomination}" with address:',
            "",
            _format_table(headers, compact_rows),
        ]

    normalized = [
        {
            "timestamp": row.get("timestamp", ""),
            "account_id": row.get("account_id", ""),
            "address": row.get("address", ""),
            "denomination": row.get("denomination", denomination),
            "phase": row.get("phase", "POSTING_PHASE_COMMITTED"),
            "asset": row.get("asset", "COMMERCIAL_BANK_MONEY"),
            "balance": row.get("balance", "0"),
        }
        for row in rows
    ]
    return [
        "* Check the balances with address and denomination:",
        "",
        _format_table(
            ["timestamp", "account_id", "address", "denomination", "phase", "asset", "balance"],
            normalized,
        ),
    ]


# ── Inbound / Outbound Hard Settlement ─────────────────────────────────────────

def _serialize_hard_settlement(data: dict[str, Any], inbound: bool) -> list[str]:
    timestamp = data.get("timestamp", "")
    amount = _format_amount(data.get("amount", "0"))
    denomination = data.get("denomination") or "VND"
    from_account = data.get("from_account", "")
    to_account = data.get("to_account", "")
    details = data.get("instruction_detail") or []

    if inbound:
        step = (
            f'* At "{timestamp}", make an Inbound Hard Settlement of "{amount}" "{denomination}" '
            f'from internal account ID "{from_account}" to customer account ID "{to_account}"'
        )
    else:
        step = (
            f'* At "{timestamp}", make an Outbound Hard Settlement of "{amount}" "{denomination}" '
            f'from customer account ID "{from_account}" to internal account ID "{to_account}"'
        )

    if not details:
        return [step + "."]
    return [step + " with parameters:", "", _format_table(["key", "value"], details)]


# ── Inbound Authorisation ──────────────────────────────────────────────────────

def _serialize_inbound_auth(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    amount = _format_amount(data.get("amount", "0"))
    denomination = data.get("denomination") or "VND"
    internal = data.get("internal_account_id", "")
    customer = data.get("customer_account_id", "")
    details = data.get("instruction_detail") or []

    step = (
        f'* At "{timestamp}", make an Inbound Authorisation of "{amount}" "{denomination}" '
        f'from internal account ID "{internal}" to customer account ID "{customer}"'
    )
    if not details:
        return [step + "."]
    return [step + " with parameters:", "", _format_table(["key", "value"], details)]


# ── Outbound Authorisation ─────────────────────────────────────────────────────

def _serialize_outbound_auth(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    amount = _format_amount(data.get("amount", "0"))
    denomination = data.get("denomination") or "VND"
    customer = data.get("customer_account_id", "")
    internal = data.get("internal_account_id", "")
    details = data.get("instruction_detail") or []

    step = (
        f'* At "{timestamp}", make an Outbound Authorisation of "{amount}" "{denomination}" '
        f'from customer account ID "{customer}" to internal account ID "{internal}"'
    )
    if not details:
        return [step + "."]
    return [step + " with parameters:", "", _format_table(["key", "value"], details)]


# ── Transfer ───────────────────────────────────────────────────────────────────

def _serialize_transfer(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    amount = _format_amount(data.get("amount", "0"))
    denomination = data.get("denomination") or "VND"
    debtor = data.get("debtor_account_id", "")
    creditor = data.get("creditor_account_id", "")
    details = data.get("instruction_detail") or []

    step = (
        f'* At "{timestamp}", make a Transfer of "{amount}" "{denomination}" '
        f'from debtor account ID "{debtor}" to creditor account ID "{creditor}"'
    )
    if not details:
        return [step + "."]
    return [step + " with parameters:", "", _format_table(["key", "value"], details)]


# ── Settlement (posting instruction) ──────────────────────────────────────────

def _serialize_settlement_instruction(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    amount = _format_amount(data.get("amount", "0"))
    txn_id = data.get("client_transaction_id", "")
    details = data.get("instruction_detail") or []

    step = (
        f'* At "{timestamp}", make a Settlement of "{amount}" '
        f'with transaction ID "{txn_id}"'
    )
    if not details:
        return [step + "."]
    return [step + " and parameters:", "", _format_table(["key", "value"], details)]


# ── Release Event ──────────────────────────────────────────────────────────────

def _serialize_release(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    txn_id = data.get("client_transaction_id", "")
    details = data.get("instruction_detail") or []

    step = f'* At "{timestamp}", make a release event with transaction ID "{txn_id}"'
    if not details:
        return [step + "."]
    return [step + " and instruction detail:", "", _format_table(["key", "value"], details)]


# ── Custom Instruction ─────────────────────────────────────────────────────────

def _serialize_custom_instruction(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    amount = _format_amount(data.get("amount", "0"))
    denomination = data.get("denomination") or "VND"
    debtor = data.get("debtor_account_id", "")
    debtor_addr = data.get("debtor_account_address", "")
    creditor = data.get("creditor_account_id", "")
    creditor_addr = data.get("creditor_account_address", "")

    step = (
        f'* At "{timestamp}", make a Custom Instruction of "{amount}" "{denomination}" '
        f'from debtor account ID "{debtor}" with address "{debtor_addr}" '
        f'to creditor account ID "{creditor}" with address "{creditor_addr}".'
    )
    return [step]


# ── Posting Instruction Batch ──────────────────────────────────────────────────

def _serialize_posting_instruction_batch(data: dict[str, Any]) -> list[str]:
    raw = data.get("raw_text", "")
    if raw:
        return [raw if raw.startswith("* ") else f"* {raw}"]
    timestamp = data.get("timestamp", "")
    instructions = data.get("instructions") or []
    if not instructions:
        return [f'* At "{timestamp}", make a posting instruction batch with the following posting instructions:']
    return [
        f'* At "{timestamp}", make a posting instruction batch with the following posting instructions:',
        "",
        _format_table(list(instructions[0].keys()) if instructions else [], instructions),
    ]


# ── Rejected ───────────────────────────────────────────────────────────────────

def _serialize_rejected(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    account_id = data.get("account_id", "")
    rejection_type = data.get("reason_code") or "AgainstTermsAndConditions"
    cv_code = data.get("contract_violation_code") or "CV_000"
    details = list(data.get("details") or [])
    reason_text = data.get("reason_text")
    if reason_text and not any(row.get("key") in {"reason", "reason_text"} for row in details):
        details.insert(0, {"key": "reason_text", "value": reason_text})

    step = (
        f'* At "{timestamp}", verify that the transaction of account ID "{account_id}" is '
        f'rejected due to "{rejection_type}" with contract violation code "{cv_code}"'
    )
    if not details:
        return [step + "."]
    return [step + " and details:", "", _format_table(["key", "value"], details)]


# ── Notification ───────────────────────────────────────────────────────────────

def _serialize_notification(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    account_id = data.get("account_id", "")
    notification_type = data.get("notification_type", "")
    details = data.get("notification_details") or []
    if data.get("expected", True) is False:
        return [
            f'* At "{timestamp}", check if the account ID "{account_id}" has no notification type '
            f'"{notification_type}".'
        ]
    return [
        f'* At "{timestamp}", check if the account ID "{account_id}" has the notification type '
        f'"{notification_type}" with details:',
        "",
        _format_table(["key", "value"], details),
    ]


# ── Table / Amount helpers ─────────────────────────────────────────────────────

def _format_table(headers: list[str], rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    table_rows = [headers] + [[str(row.get(header, "")) for header in headers] for row in rows]
    widths = [max(max(len(str(cell)) for cell in col), 3) for col in zip(*table_rows)]

    def fmt(cells: list[Any]) -> str:
        return "  | " + " | ".join(str(cell).ljust(widths[idx]) for idx, cell in enumerate(cells)) + " |"

    separator = "  | " + " | ".join("-" * width for width in widths) + " |"
    return "\n".join([fmt(headers), separator, *[fmt([row.get(header, "") for header in headers]) for row in rows]])


def _format_amount(value: Any) -> str:
    raw = str(value or "0").replace("_", "").replace(",", "")
    try:
        number = int(raw)
    except ValueError:
        return raw
    return f"{number:,}".replace(",", "_")
