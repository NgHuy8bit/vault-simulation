from fastapi import APIRouter, HTTPException, Query

from app.core.config import SPEC_BASE
from app.core.paths import safe_resolve
from app.models.spec import ParsedSpec, SaveSpecRequest
from app.services.spec_parser import parse_spec_content
from app.services.spec_serializer import serialize_spec

router = APIRouter(prefix="/api", tags=["specs"])


@router.get("/find-spec")
def find_spec(response_path: str = Query(..., alias="response-path")):
    parent_dir = "/".join(response_path.split("/")[:-1])
    spec_rel_path = f"{parent_dir}.spec"
    target = safe_resolve(SPEC_BASE, spec_rel_path)
    if not target.exists():
        return {"found": False}
    return {"found": True, "content": target.read_text("utf-8"), "path": spec_rel_path}


@router.get("/spec")
def read_spec(path: str = Query(...)):
    target = safe_resolve(SPEC_BASE, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Spec not found")
    return {"content": target.read_text("utf-8"), "path": path}


@router.get("/parse-spec", response_model=ParsedSpec)
def parse_spec(path: str = Query(...)):
    target = safe_resolve(SPEC_BASE, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Spec not found")
    return parse_spec_content(target.read_text("utf-8"))


@router.post("/save-spec")
def save_spec(payload: SaveSpecRequest):
    rel_path = payload.path.strip()
    if not rel_path.endswith(".spec"):
        raise HTTPException(status_code=400, detail="Path must end with .spec")

    target = safe_resolve(SPEC_BASE, rel_path)
    if payload.steps_json is not None:
        content = serialize_spec(payload.steps_json.model_dump())
    else:
        content = payload.raw_content if payload.raw_content is not None else payload.content
        if content is None:
            raise HTTPException(status_code=400, detail="Missing steps_json or raw_content")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, "utf-8")
    return {"ok": True, "path": rel_path}
