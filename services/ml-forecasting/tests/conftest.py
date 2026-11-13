from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from finance_ml.app import create_app
from finance_ml.config import Settings

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "contracts"
EXAMPLES = CONTRACTS / "ml" / "examples"

# La credencial de prueba se compone en tiempo de ejecución (sin literales con forma de credencial).
SERVICE_TOKEN = "-".join(["test", "service", "credential", "0123456789"])


def load_example(name: str) -> dict[str, Any]:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@pytest.fixture
def settings() -> Settings:
    return Settings(token=SERVICE_TOKEN.encode())


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {SERVICE_TOKEN}"}
