import re
from typing import Any


def process_simulation_response(raw_data: Any) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    accounts_latest: dict[str, dict[str, Any]] = {}
    balance_history: dict[str, Any] = {}
    account_history: dict[str, Any] = {}
    denominations: set[str] = set()
    account_ids: set[str] = set()

    for idx, item in enumerate(_simulation_items(raw_data)):
        result = item.get("result", item)
        timestamp = item.get("timestamp") or result.get("timestamp", "")
        logs = result.get("logs", []) or []
        batches = result.get("posting_instruction_batches", []) or []
        balances = result.get("balances", {}) or {}
        hook_logs = result.get("hook_execution_logs", []) or []
        notifications = _extract_notifications(result.get("contract_notification_events", {}))

        has_postings = bool(batches)
        is_rejected = any("REJECTED" in (batch.get("status", "") or "") for batch in batches) or any(
            re.search(r"\brejected\b", line, re.IGNORECASE) for line in logs
        )

        event_type = _event_type(batches, notifications, logs, is_rejected)
        summary = _event_summary(batches, notifications, logs, is_rejected)
        rejection_reason = _rejection_reason(logs, batches) if is_rejected else ""
        notification = notifications[0] if notifications else {}

        events.append(
            {
                "id": idx,
                "timestamp": timestamp,
                "type": event_type,
                "status": "rejected" if is_rejected else ("accepted" if has_postings else None),
                "rejection_reason": rejection_reason,
                "account_id": _extract_account_id(batches, notifications, balances),
                "postings": _flatten_posting_instructions(batches),
                "notification_type": notification.get("notification_type", ""),
                "notification_details": notification.get("notification_details", {}),
                "logs": logs,
                "summary": summary[:90],
                "has_postings": has_postings,
                "has_balances": bool(balances),
                "is_rejected": is_rejected,
                "pibs": batches,
                "hook_logs": hook_logs,
                "notifications": notifications,
            }
        )

        _collect_balances(
            timestamp=timestamp,
            balances=balances,
            account_ids=account_ids,
            denominations=denominations,
            accounts_latest=accounts_latest,
            balance_history=balance_history,
            account_history=account_history,
        )

    timestamps = [event["timestamp"] for event in events if event["timestamp"]]
    return {
        "events": events,
        "balances": _latest_balances(accounts_latest),
        "balance_history": balance_history,
        "account_history": account_history,
        "accounts": sorted(account_ids),
        "denominations": sorted(denominations),
        "time_range": {"start": min(timestamps, default=""), "end": max(timestamps, default="")},
    }


def _simulation_items(raw_data: Any) -> list[dict[str, Any]]:
    if isinstance(raw_data, list):
        return raw_data
    if isinstance(raw_data, dict):
        result = raw_data.get("result", raw_data)
        if isinstance(result, dict):
            for key in ("SmartContractSimulationResults", "smart_contract_simulation_results", "simulation_results"):
                value = result.get(key)
                if isinstance(value, list):
                    return value
    return []


def _event_type(
    batches: list[dict[str, Any]],
    notifications: list[dict[str, Any]],
    logs: list[str],
    is_rejected: bool,
) -> str:
    if batches:
        return "accrual" if any(_is_accrual_batch(batch) for batch in batches) else "posting"
    if notifications:
        return "notification"
    if logs or is_rejected:
        return "setup"
    return "setup"


def _event_summary(
    batches: list[dict[str, Any]],
    notifications: list[dict[str, Any]],
    logs: list[str],
    is_rejected: bool,
) -> str:
    if notifications:
        return notifications[0].get("notification_type", "")
    if is_rejected and logs:
        line = next((log for log in logs if "reason" in log.lower()), logs[0])
        return re.sub(r'^account "[^"]*" rejected[^"]*reason ', "", line).strip('"')
    if batches:
        return batches[0].get("client_batch_id") or batches[0].get("id") or ""
    return logs[0] if logs else ""


def _rejection_reason(logs: list[str], batches: list[dict[str, Any]]) -> str:
    for line in logs:
        match = re.search(r'reason "([^"]+)"', line)
        if match:
            return match.group(1)
    return next((batch.get("rejection_reason", "") for batch in batches if batch.get("rejection_reason")), "")


def _collect_balances(
    timestamp: str,
    balances: dict[str, Any],
    account_ids: set[str],
    denominations: set[str],
    accounts_latest: dict[str, dict[str, Any]],
    balance_history: dict[str, Any],
    account_history: dict[str, Any],
) -> None:
    for account_id, account_data in balances.items():
        account_ids.add(account_id)
        accounts_latest.setdefault(account_id, {})
        balance_history.setdefault(account_id, {})
        account_history.setdefault(account_id, {})

        for balance in account_data.get("balances", []):
            address = balance.get("account_address", "")
            denomination = balance.get("denomination", "")
            asset = balance.get("asset", "")
            amount = balance.get("amount", "0")
            denominations.add(denomination)

            key = f"{address}|||{denomination}|||{asset}"
            latest = {
                "address": address,
                "denomination": denomination,
                "asset": asset,
                "amount": amount,
                "total_debit": balance.get("total_debit", "0"),
                "total_credit": balance.get("total_credit", "0"),
                "timestamp": timestamp,
            }
            accounts_latest[account_id][key] = latest

            amount_float = _to_float(amount)
            account_history[account_id].setdefault(key, []).append(
                {
                    **latest,
                    "amount_float": amount_float,
                }
            )

            if asset == "COMMERCIAL_BANK_MONEY":
                balance_history[account_id].setdefault(denomination, {}).setdefault(address, []).append(
                    {"timestamp": timestamp, "amount": amount_float}
                )


def _latest_balances(accounts_latest: dict[str, dict[str, Any]]) -> dict[str, Any]:
    balances: dict[str, Any] = {}
    for account_id, by_key in accounts_latest.items():
        monetary = []
        params = []
        all_balances = []
        for balance in by_key.values():
            all_balances.append(balance)
            if balance["asset"] == "COMMERCIAL_BANK_MONEY":
                monetary.append(
                    {
                        "address": balance["address"],
                        "denomination": balance["denomination"],
                        "amount": balance["amount"],
                        "total_debit": balance["total_debit"],
                        "total_credit": balance["total_credit"],
                        "timestamp": balance["timestamp"],
                    }
                )
            elif balance["asset"] == "PRODUCT_CONFIGURATION":
                params.append({"name": balance["address"], "value": balance["amount"]})
        balances[account_id] = {"monetary": monetary, "params": params, "all": all_balances}
    return balances


def _extract_notifications(raw_notifications: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_notifications, dict):
        return []
    notifications = []
    for account_id, payload in raw_notifications.items():
        events = payload.get("contract_notification_events", []) if isinstance(payload, dict) else []
        for event in events:
            details = event.get("notification_details", {}) or {}
            notifications.append(
                {
                    "account_id": details.get("account_id") or event.get("resource_id") or account_id,
                    "notification_type": event.get("notification_type", ""),
                    "notification_details": details,
                    "resource_id": event.get("resource_id", ""),
                    "resource_type": event.get("resource_type", ""),
                }
            )
    return notifications


def _flatten_posting_instructions(batches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    instructions = []
    for batch in batches:
        instructions.extend(batch.get("posting_instructions", []))
    return instructions


def _extract_account_id(
    batches: list[dict[str, Any]],
    notifications: list[dict[str, Any]],
    balances: dict[str, Any],
) -> str:
    for notification in notifications:
        if notification.get("account_id"):
            return notification["account_id"]
    for batch in batches:
        for posting in _posting_list(batch):
            account_id = posting.get("account_id", "")
            if account_id and account_id != "1":
                return account_id
    if len(balances) == 1:
        return next(iter(balances))
    return ""


def _posting_list(batch: dict[str, Any]) -> list[dict[str, Any]]:
    postings = []
    for instruction in batch.get("posting_instructions", []):
        postings.extend(instruction.get("committed_postings", []))
        postings.extend(instruction.get("custom_instruction", {}).get("postings", []))
    return postings


def _is_accrual_batch(batch: dict[str, Any]) -> bool:
    haystack = [batch.get("client_batch_id", ""), batch.get("id", "")]
    for instruction in batch.get("posting_instructions", []):
        details = instruction.get("instruction_details", {}) or {}
        haystack.extend(str(value) for value in details.values())
        haystack.append(instruction.get("client_transaction_id", ""))
    text = " ".join(haystack).upper()
    return "ACCRUE" in text or "ACCRUAL" in text


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
