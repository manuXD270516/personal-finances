from __future__ import annotations

import json

import jsonschema
import pytest
import yaml

from finance_ml.schemas import ForecastRequestV1, ForecastResponseV1

from .conftest import CONTRACTS, load_example

REQUEST_SCHEMA = json.loads((CONTRACTS / "ml" / "forecast-request.v1.schema.json").read_text(encoding="utf-8"))
RESPONSE_SCHEMA = json.loads((CONTRACTS / "ml" / "forecast-response.v1.schema.json").read_text(encoding="utf-8"))


def test_openapi_generado_coincide_con_el_publicado() -> None:
    """[TC-PLATFORM-MLSERVICE-003] El OpenAPI que genera la aplicación coincide con contracts/openapi."""
    from scripts.export_openapi import TARGET, generated

    published = yaml.safe_load(TARGET.read_text(encoding="utf-8"))
    assert json.loads(json.dumps(generated(), sort_keys=True)) == json.loads(json.dumps(published, sort_keys=True)), (
        "contrato desalineado: ejecuta `uv run python scripts/export_openapi.py` y revisa el cambio"
    )


@pytest.mark.parametrize("name", ["request.valid.json"])
def test_ejemplo_valido_de_peticion(name: str) -> None:
    """[TC-PLATFORM-MLSERVICE-003] El ejemplo válido cumple el JSON Schema y el modelo."""
    body = load_example(name)
    jsonschema.validate(body, REQUEST_SCHEMA)
    ForecastRequestV1.model_validate(body)


@pytest.mark.parametrize("name", ["request.invalid-extra-field.json", "request.invalid-horizon.json"])
def test_ejemplos_invalidos_de_peticion(name: str) -> None:
    """[TC-PLATFORM-MLSERVICE-003] Los ejemplos inválidos se rechazan por el JSON Schema y por el modelo."""
    body = load_example(name)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(body, REQUEST_SCHEMA)
    with pytest.raises(ValueError):  # noqa: PT011
        ForecastRequestV1.model_validate(body)


def test_ejemplos_de_respuesta() -> None:
    """[TC-PLATFORM-MLSERVICE-003] La respuesta de ejemplo cumple ambos; la inválida, ninguno."""
    ok = load_example("response.valid.json")
    jsonschema.validate(ok, RESPONSE_SCHEMA)
    ForecastResponseV1.model_validate(ok)
    bad = load_example("response.invalid-missing-version.json")
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, RESPONSE_SCHEMA)
    with pytest.raises(ValueError):  # noqa: PT011
        ForecastResponseV1.model_validate(bad)
