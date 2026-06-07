from pathlib import Path

VIEWER_DIR = Path(__file__).resolve().parents[3]
SOURCE_ROOT = VIEWER_DIR.parent.parent

SIMULATION_BASE = (SOURCE_ROOT / "smart-contracts/.gauge/simulation").resolve()
SPEC_BASE = (SOURCE_ROOT / "smart-contracts/specs").resolve()
SMART_CONTRACTS_DIR = (SOURCE_ROOT / "smart-contracts").resolve()

APP_NAME = "Vault Simulation Viewer API"
