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
    if step_type == "auth_adjustment":
        return [
            f'* At "{data.get("timestamp", "")}", auth adjustment "{_format_amount(data.get("amount", "0"))}" '
            f'for client transaction ID "{data.get("client_transaction_id", "")}".'
        ]
    if step_type == "accepted":
        return [
            f'* At "{data.get("timestamp", "")}", verify that the transaction of '
            f'account ID "{data.get("account_id", "")}" is accepted.'
        ]
    if step_type == "rejected":
        return _serialize_rejected(data)
    if step_type == "notification":
        return _serialize_notification(data)
    if step_type == "no_notifications":
        return ["* Expect no contract notifications."]
    if step_type == "schedule":
        return [
            f'* At "{data.get("timestamp", "")}", verify that the expected schedule of '
            f'account ID "{data.get("account_id", "")}" with event "{data.get("event_id", "")}".'
        ]
    if step_type == "parameter_rejected":
        return [
            f'* At "{data.get("timestamp", "")}", verify that the parameter change of '
            f'account ID "{data.get("account_id", "")}" is rejected due to '
            f'"{data.get("rejection_type", "AgainstTermsAndConditions")}" '
            f'with reason "{data.get("rejection_reason", "")}".'
        ]
    if step_type == "derived_parameters":
        rows = data.get("rows") or []
        return [
            f'* At "{data.get("timestamp", "")}", verify that the parameters of '
            f'account ID "{data.get("account_id", "")}" should be:',
            "",
            _format_table(["name", "value"], rows),
        ]
    if step_type == "change_instance_params":
        rows = data.get("params") or []
        return [
            f'* Change instance parameters account ID "{data.get("account_id", "")}":',
            "",
            _format_table(["name", "value"], rows),
        ]
    if step_type == "change_template_params":
        rows = data.get("params") or []
        return [
            f'* Change template parameters product version ID "{data.get("product_version_id", "")}":',
            "",
            _format_table(["name", "value"], rows),
        ]
    if step_type == "update_account_status":
        return [
            f'* At "{data.get("timestamp", "")}", update the status of account ID '
            f'"{data.get("account_id", "")}" to "{data.get("status", "")}".'
        ]
    if step_type == "account_close":
        return [
            f'* At "{data.get("timestamp", "")}", update account status to pending closure '
            f'for account ID "{data.get("account_id", "")}".'
        ]
    if step_type == "update_account_version":
        return [
            f'* At "{data.get("timestamp", "")}", update account ID "{data.get("account_id", "")}" '
            f'to product version ID "{data.get("product_version_id", "")}".'
        ]
    if step_type == "flag_definition":
        return [
            f'* At "{data.get("timestamp", "")}", create a Flag Definition Event for '
            f'"{data.get("flag_name", "")}".'
        ]
    if step_type == "flag":
        return [
            f'* At "{data.get("timestamp", "")}", set "{data.get("flag_name", "")}" '
            f'on customer account ID "{data.get("account_id", "")}" '
            f'with an expiry date of "{data.get("expiry_timestamp", "")}".'
        ]
    if step_type == "balance_check_multi":
        return _serialize_balance_check_multi(data)
    if step_type == "global_param":
        return _serialize_global_param(data)
    if step_type == "derived_parameter_dict":
        return [
            f'* At "{data.get("timestamp", "")}", verify that the parameter '
            f'"{data.get("param_name", "")}" of account ID "{data.get("account_id", "")}" '
            f'should be "{data.get("value", "")}".'
        ]
    if step_type == "exception_msg":
        return [f'* Assert an exception when closed account with message "{data.get("message", "")}".']
    if step_type == "instruction_detail_check":
        rows = data.get("rows") or []
        return [
            f'* At "{data.get("timestamp", "")}", verify that posting instruction details contain:',
            "",
            _format_table(list(rows[0].keys()) if rows else ["key", "value"], rows),
        ]
    if step_type == "batch_detail_check":
        rows = data.get("rows") or []
        return [
            f'* At "{data.get("timestamp", "")}", check batch details contain the following metadata:',
            "",
            _format_table(list(rows[0].keys()) if rows else ["key", "value"], rows),
        ]

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
    _DEF_PHASE = "POSTING_PHASE_COMMITTED"
    _DEF_ASSET = "COMMERCIAL_BANK_MONEY"

    rows = sorted(data.get("rows") or [], key=lambda row: row.get("timestamp", ""))
    denomination = data.get("denomination") or (rows[0].get("denomination") if rows else "VND")
    account_ids = {row.get("account_id", "") for row in rows}

    if len(account_ids) == 1 and "" not in account_ids:
        account_id = next(iter(account_ids))
        has_phase = any(r.get("phase", _DEF_PHASE) not in ("", _DEF_PHASE) for r in rows)
        compact_rows = [
            {
                "timestamp": row.get("timestamp", ""),
                "address": row.get("address", ""),
                "balance": row.get("balance", "0"),
                **(({"phase": row.get("phase")}) if has_phase else {}),
            }
            for row in rows
        ]
        headers = ["timestamp", "address", "balance"]
        if has_phase:
            headers.append("phase")
        return [
            f'* Check the balances of account "{account_id}" and denomination "{denomination}" with address:',
            "",
            _format_table(headers, compact_rows),
        ]

    has_phase = any(r.get("phase", _DEF_PHASE) not in ("", _DEF_PHASE) for r in rows)
    has_asset = any(r.get("asset", _DEF_ASSET) not in ("", _DEF_ASSET) for r in rows)
    headers = ["timestamp", "account_id", "address", "denomination", "balance"]
    if has_phase:
        headers.append("phase")
    if has_asset:
        headers.append("asset")
    normalized = [
        {
            "timestamp": row.get("timestamp", ""),
            "account_id": row.get("account_id", ""),
            "address": row.get("address", ""),
            "denomination": row.get("denomination", denomination),
            "balance": row.get("balance", "0"),
            **({"phase": row.get("phase")} if has_phase else {}),
            **({"asset": row.get("asset")} if has_asset else {}),
        }
        for row in rows
    ]
    return [
        "* Check the balances with address and denomination:",
        "",
        _format_table(headers, normalized),
    ]


# ── Inbound / Outbound Hard Settlement ─────────────────────────────────────────
# Inbound:  "make an Inbound Hard Settlement ... from internal account ID X to customer account ID Y"
# Outbound: "make an Outbound Hard Settlement ... from customer account ID X to internal account ID Y"

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
# Step: "make an Inbound Authorisation of <amount> <denom>
#        from internal account ID <internal_account_id> to customer account ID <customer_account_id>."

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
# Step: "make an Outbound Authorisation of <amount> <denom>
#        from customer account ID <customer_account_id> to internal account ID <internal_account_id>."

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
# Step: "make a Transfer of <amount> <denom>
#        from debtor account ID <debtor_account_id> to creditor account ID <creditor_account_id>."

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
# Step: "make a Settlement of <amount> with transaction ID <client_transaction_id>."

def _serialize_settlement_instruction(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    amount = _format_amount(data.get("amount", "0"))
    txn_id = data.get("client_transaction_id", "")
    details = data.get("instruction_detail") or []

    step = f'* At "{timestamp}", make a Settlement of "{amount}" with transaction ID "{txn_id}"'
    if not details:
        return [step + "."]
    return [step + " and parameters:", "", _format_table(["key", "value"], details)]


# ── Release Event ──────────────────────────────────────────────────────────────
# Step: "make a release event with transaction ID <client_transaction_id>."

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

    return [
        f'* At "{timestamp}", make a Custom Instruction of "{amount}" "{denomination}" '
        f'from debtor account ID "{debtor}" with address "{debtor_addr}" '
        f'to creditor account ID "{creditor}" with address "{creditor_addr}".'
    ]


# ── Posting Instruction Batch ──────────────────────────────────────────────────
# Step: "make a posting instruction batch ..." or "initiate an instruction batch with: <table>"

def _serialize_posting_instruction_batch(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    instructions = data.get("instructions") or []

    if not instructions:
        return [f'* At "{timestamp}", make a posting instruction batch with the following posting instructions:']

    headers = list(instructions[0].keys()) if instructions else []
    return [
        f'* At "{timestamp}", make a posting instruction batch with the following posting instructions:',
        "",
        _format_table(headers, instructions),
    ]


# ── Rejected ───────────────────────────────────────────────────────────────────
# Step: "verify that the transaction of account ID X is rejected due to Y with reason Z."

def _serialize_rejected(data: dict[str, Any]) -> list[str]:
    timestamp = data.get("timestamp", "")
    account_id = data.get("account_id", "")
    rejection_type = (
        data.get("rejection_type")
        or data.get("reason_code")
        or "AgainstTermsAndConditions"
    )
    rejection_reason = data.get("rejection_reason") or data.get("reason_text") or ""

    return [
        f'* At "{timestamp}", verify that the transaction of account ID "{account_id}" is '
        f'rejected due to "{rejection_type}" with reason "{rejection_reason}".'
    ]


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
        f'* At "{timestamp}", check if the account ID "{account_id}" has notification type '
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


def _serialize_balance_check_multi(data: dict[str, Any]) -> list[str]:
    denomination = data.get("denomination") or "VND"
    rows = sorted(data.get("rows") or [], key=lambda r: r.get("timestamp", ""))

    _DEF_PHASE = "POSTING_PHASE_COMMITTED"
    _DEF_ASSET = "COMMERCIAL_BANK_MONEY"

    # Only add optional columns when at least one row has a non-default value
    has_multi_denom = any(r.get("denomination", denomination) != denomination for r in rows)
    has_phase = any(r.get("phase", _DEF_PHASE) not in ("", _DEF_PHASE) for r in rows)
    has_asset = any(r.get("asset", _DEF_ASSET) not in ("", _DEF_ASSET) for r in rows)

    headers = ["timestamp", "account_id", "address", "balance"]
    if has_multi_denom:
        headers.append("denomination")
    if has_phase:
        headers.append("phase")
    if has_asset:
        headers.append("asset")

    return [
        f'* Check the balances denomination "{denomination}" with multiple account and address:',
        "",
        _format_table(headers, rows),
    ]


def _serialize_global_param(data: dict[str, Any]) -> list[str]:
    rows = data.get("rows") or []
    timestamp = data.get("timestamp") or ""
    name = data.get("name") or ""
    value = data.get("value") or ""
    raw = data.get("raw_text")
    if rows and rows[0]:
        cols = list(rows[0].keys()) or ["name", "value"]
        prefix = f'* At "{timestamp}", create global parameters with values:' if timestamp else "* Create multiple global parameter:"
        return [prefix, "", _format_table(cols, rows)]
    if raw:
        return [raw if raw.startswith("* ") else f"* {raw}"]
    if timestamp:
        return [f'* At "{timestamp}", create global parameter "{name}" with value "{value}"']
    return [f'* Create global parameter with start "", parameter ID "{name}", value "{value}".']


def _format_amount(value: Any) -> str:
    raw = str(value or "0").replace("_", "").replace(",", "")
    try:
        number = int(raw)
    except ValueError:
        return raw
    return f"{number:,}".replace(",", "_")
