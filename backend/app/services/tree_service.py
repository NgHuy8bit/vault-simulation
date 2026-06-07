import re
from pathlib import Path
from typing import Any

from app.core.config import SIMULATION_BASE, SPEC_BASE


def _normalize(name: str) -> str:
    """Lowercase + collapse non-alphanumeric runs to underscore — used for response file matching."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _extract_scenarios(spec_path: Path) -> list[dict[str, Any]]:
    """Parse ## headers from spec file — fast, no full parse needed."""
    scenarios: list[dict[str, Any]] = []
    try:
        for i, line in enumerate(spec_path.read_text("utf-8").splitlines()):
            m = re.match(r"^##\s+(.+?)(?:\s+@\S+)*\s*$", line)
            if m:
                scenarios.append({"name": m.group(1).strip(), "lineNumber": i + 1})
    except Exception:
        pass
    return scenarios


def build_tree(directory: Path = SPEC_BASE) -> dict[str, Any]:
    result: dict[str, Any] = {"dirs": {}, "files": []}
    if not directory.exists():
        return result

    entries = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    for entry in entries:
        rel_spec = str(entry.relative_to(SPEC_BASE))
        if entry.is_dir():
            subtree = build_tree(entry)
            if subtree["files"] or subtree["dirs"]:
                result["dirs"][entry.name] = {"path": rel_spec, **subtree}
        elif entry.name.endswith(".spec"):
            spec_base_name = entry.name[:-5]
            sim_dir = SIMULATION_BASE / entry.relative_to(SPEC_BASE).parent / spec_base_name

            # Build a lookup of normalized response name → full response info
            response_lookup: dict[str, dict[str, Any]] = {}
            if sim_dir.exists() and sim_dir.is_dir():
                for sim_entry in sim_dir.iterdir():
                    if sim_entry.name.endswith(".response.json"):
                        stem = sim_entry.name[: -len(".response.json")]
                        req_file = sim_entry.with_name(stem + ".request.json")
                        response_lookup[stem] = {
                            "responsePath": str(sim_entry.relative_to(SIMULATION_BASE)),
                            "requestPath": str(req_file.relative_to(SIMULATION_BASE)) if req_file.exists() else None,
                        }

            # Extract scenario names from spec content, then match to response files
            spec_scenarios = _extract_scenarios(entry)
            scenarios: list[dict[str, Any]] = []

            # Skip the first scenario if it looks like a global setup block
            display_scenarios = spec_scenarios
            if spec_scenarios:
                first_name = spec_scenarios[0]["name"].lower()
                if "set up" in first_name or "setup" in first_name or "global environment" in first_name:
                    display_scenarios = spec_scenarios[1:]

            for sc in display_scenarios:
                normalized = _normalize(sc["name"])
                resp = response_lookup.get(normalized, {})
                scenarios.append(
                    {
                        "name": sc["name"],
                        "lineNumber": sc["lineNumber"],
                        "responsePath": resp.get("responsePath"),
                        "requestPath": resp.get("requestPath"),
                        "hasResponse": bool(resp),
                    }
                )

            # Also add any response files that didn't match a spec scenario (orphaned)
            matched_stems = {_normalize(sc["name"]) for sc in display_scenarios}
            for stem, resp in response_lookup.items():
                if stem not in matched_stems:
                    scenarios.append(
                        {
                            "name": stem.replace("_", " "),
                            "lineNumber": None,
                            "responsePath": resp["responsePath"],
                            "requestPath": resp["requestPath"],
                            "hasResponse": True,
                        }
                    )

            scenarios.sort(key=lambda s: (s["lineNumber"] is None, s["lineNumber"] or 0, s["name"]))

            result["files"].append(
                {
                    "name": spec_base_name,
                    "specPath": rel_spec,
                    "scenarios": scenarios,
                    "hasResponses": any(s["hasResponse"] for s in scenarios),
                }
            )

    result["files"].sort(key=lambda item: item["name"])
    return result
