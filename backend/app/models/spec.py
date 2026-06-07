from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

StepType = Literal[
    # setup
    "config",
    "product",
    "account",
    # posting instructions
    "inbound",
    "outbound",
    "inbound_auth",
    "outbound_auth",
    "transfer",
    "settlement",
    "release",
    "custom_instruction",
    "posting_instruction_batch",
    "auth_adjustment",
    # checks
    "balance_check",
    "balance_check_multi",
    "accepted",
    "rejected",
    "notification",
    "no_notifications",
    "schedule",
    "parameter_rejected",
    "derived_parameters",
    "derived_parameter_dict",
    # account management
    "change_instance_params",
    "change_template_params",
    "update_account_status",
    "account_close",
    "update_account_version",
    "exception_msg",
    # flags
    "flag_definition",
    "flag",
    # misc
    "global_param",
    "instruction_detail_check",
    "batch_detail_check",
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
