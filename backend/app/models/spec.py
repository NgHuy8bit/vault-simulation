from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

StepType = Literal[
    "config",
    "product",
    "account",
    "balance_check",
    "inbound",
    "outbound",
    "accepted",
    "rejected",
    "notification",
    "other",
]


class KeyValueRow(BaseModel):
    key: str = ""
    value: str = ""


class SpecStep(BaseModel):
    type: StepType
    raw: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class SpecScenario(BaseModel):
    name: str
    tags: list[str] = Field(default_factory=list)
    steps: list[SpecStep] = Field(default_factory=list)


class ParsedSpec(BaseModel):
    title: str = ""
    file_tags: list[str] = Field(default_factory=list)
    setup_steps: list[SpecStep] = Field(default_factory=list)
    scenarios: list[SpecScenario] = Field(default_factory=list)


class SaveSpecRequest(BaseModel):
    path: str
    steps_json: Optional[ParsedSpec] = None
    raw_content: Optional[str] = None
    content: Optional[str] = None
