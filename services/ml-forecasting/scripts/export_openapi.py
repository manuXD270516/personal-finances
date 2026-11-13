"""Genera `contracts/openapi/ml-forecasting.v1.yaml` desde la aplicación (uv run python scripts/export_openapi.py)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

from finance_ml.app import create_app
from finance_ml.config import Settings

TARGET = Path(__file__).resolve().parents[3] / "contracts" / "openapi" / "ml-forecasting.v1.yaml"
HEADER = (
    "# Contrato interno del servicio de pronósticos (finance-ml). GENERADO por\n"
    "# services/ml-forecasting/scripts/export_openapi.py: no se edita a mano (el job `ml` de CI compara).\n"
)


def generated() -> dict[str, object]:
    spec = create_app(Settings(token=b"x")).openapi()
    return json.loads(json.dumps(spec))  # type: ignore[no-any-return]


def main() -> int:
    body = yaml.safe_dump(generated(), sort_keys=True, allow_unicode=True)
    TARGET.write_text(HEADER + body, encoding="utf-8")
    print(f"escrito {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
