import json

from fastapi import APIRouter, HTTPException, Query

from app.core.paths import safe_resolve
from app.core.settings_store import get_simulation_base

router = APIRouter(prefix="/api", tags=["files"])


@router.get("/file")
def read_simulation_file(path: str = Query(...)):
    target = safe_resolve(get_simulation_base(), path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        return json.loads(target.read_text("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid JSON: {exc}") from exc
