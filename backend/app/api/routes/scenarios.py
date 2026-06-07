import json

from fastapi import APIRouter, HTTPException, Query

from app.core.config import SIMULATION_BASE
from app.core.paths import safe_resolve
from app.models.scenario import ScenarioSummary
from app.services.simulation_processor import process_simulation_response

router = APIRouter(prefix="/api", tags=["scenarios"])


@router.get("/scenario-summary", response_model=ScenarioSummary)
def scenario_summary(response_path: str = Query(..., alias="response-path")):
    target = safe_resolve(SIMULATION_BASE, response_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        raw_data = json.loads(target.read_text("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid JSON: {exc}") from exc
    request_data = None
    request_path = target.with_name(target.name.replace(".response.json", ".request.json"))
    if request_path.exists():
        try:
            request_data = json.loads(request_path.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    return process_simulation_response(raw_data, request_data)
