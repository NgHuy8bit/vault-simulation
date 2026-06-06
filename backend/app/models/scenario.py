from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class TimelineEvent(BaseModel):
    id: int
    timestamp: str
    type: str
    status: Optional[str] = None
    rejection_reason: str = ""
    account_id: str = ""
    postings: list[dict[str, Any]] = Field(default_factory=list)
    notification_type: str = ""
    notification_details: dict[str, Any] = Field(default_factory=dict)
    logs: list[str] = Field(default_factory=list)
    summary: str = ""
    has_postings: bool = False
    has_balances: bool = False
    is_rejected: bool = False
    pibs: list[dict[str, Any]] = Field(default_factory=list)
    hook_logs: list[Any] = Field(default_factory=list)
    notifications: list[dict[str, Any]] = Field(default_factory=list)


class TimeRange(BaseModel):
    start: str = ""
    end: str = ""


class ScenarioSummary(BaseModel):
    events: list[TimelineEvent]
    balances: dict[str, Any]
    balance_history: dict[str, Any]
    account_history: dict[str, Any]
    accounts: list[str]
    denominations: list[str]
    time_range: TimeRange
