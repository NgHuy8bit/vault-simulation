#!/usr/bin/env python3
"""Dump product defaults from steps.simulation into backend-go/products_defaults.json."""
from __future__ import annotations

import json
from pathlib import Path

from inception_sdk.test_framework.contracts.files import (
    EMPTY_ASSET_CONTRACT_V4,
    EMPTY_LIABILITY_CONTRACT_V4,
)
from inception_sdk.common.python.file_utils import load_file_contents
from steps.simulation.common.types import Product


def main() -> None:
    smart_contracts_dir = Path.cwd()
    out = {
        "empty_asset_contract_v4": load_file_contents(EMPTY_ASSET_CONTRACT_V4),
        "empty_liability_contract_v4": load_file_contents(EMPTY_LIABILITY_CONTRACT_V4),
        "products": {},
    }
    products = out["products"]
    for product in Product:
        info = product.value
        contract_path = info.get_contract_path
        rendered_path = (
            smart_contracts_dir
            / "products"
            / info.name
            / "contracts"
            / f"rendered_{info.name}.py"
        )
        if rendered_path.exists():
            contract_path = rendered_path.resolve(strict=True)
        products[info.name] = {
            "enum": product.name,
            "name": info.name,
            "contract_rel_path": str(contract_path.relative_to(smart_contracts_dir)),
            "internal_accounts": info.internal_accounts,
            "internal_account_order": list(info.internal_accounts),
            "required_products": sorted(p.value.name for p in info.required_products),
            "template_parameters": info.template_parameters,
            "instance_parameters": info.instance_parameters,
            "global_parameters": info.global_parameters,
        }

    target = Path(__file__).resolve().parents[1] / "internal" / "simengine" / "products_defaults.json"
    target.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
