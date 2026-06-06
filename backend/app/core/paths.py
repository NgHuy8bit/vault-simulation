from pathlib import Path

from fastapi import HTTPException


def safe_resolve(base: Path, rel_path: str) -> Path:
    if not rel_path:
        raise HTTPException(status_code=400, detail="Missing path")

    target = (base / rel_path).resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Forbidden") from exc

    return target
