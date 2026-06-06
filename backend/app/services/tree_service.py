from pathlib import Path
from typing import Any

from app.core.config import SIMULATION_BASE


def build_tree(directory: Path = SIMULATION_BASE) -> dict[str, Any]:
    result: dict[str, Any] = {"dirs": {}, "files": []}
    if not directory.exists():
        return result

    entries = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    for entry in entries:
        rel = str(entry.relative_to(SIMULATION_BASE))
        if entry.is_dir():
            subtree = build_tree(entry)
            if subtree["files"] or subtree["dirs"]:
                result["dirs"][entry.name] = {"path": rel, **subtree}
        elif entry.name.endswith(".response.json"):
            request_file = entry.with_name(entry.name.replace(".response.json", ".request.json"))
            result["files"].append(
                {
                    "name": entry.name.replace(".response.json", ""),
                    "responsePath": rel,
                    "requestPath": str(request_file.relative_to(SIMULATION_BASE))
                    if request_file.exists()
                    else None,
                }
            )

    result["files"].sort(key=lambda item: item["name"])
    return result
