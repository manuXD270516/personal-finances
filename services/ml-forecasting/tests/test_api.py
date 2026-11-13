from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import jsonschema
from fastapi.testclient import TestClient

from finance_ml.app import create_app
from finance_ml.config import Settings

from .conftest import CONTRACTS, SERVICE_TOKEN, load_example


def test_sin_credencial_se_rechaza_sin_procesar(client: TestClient) -> None:
    """[TC-FORECAST-SERVICE-034] El servicio rechaza una petición sin la credencial de servicio."""
    body = load_example("request.valid.json")
    r = client.post("/v1/forecasts", json=body)
    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHORIZED"
    bad = client.post("/v1/forecasts", json=body, headers={"Authorization": "Bearer otra"})
    assert bad.status_code == 401
    assert client.get("/v1/models").status_code == 401


def test_salud_sin_autenticacion(client: TestClient) -> None:
    """[TC-PLATFORM-MLSERVICE-002] Las sondas de salud responden sin credencial de datos ni de servicio."""
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ok"}


def test_sin_token_configurado_no_esta_listo() -> None:
    """[TC-PLATFORM-MLSERVICE-002] Sin la credencial de servicio el servicio no queda listo y rechaza todo."""
    with TestClient(create_app(Settings(token=None))) as c:
        assert c.get("/health/ready").status_code == 503
        assert c.post("/v1/forecasts", json={}).status_code == 401


def test_pronostico_valido_cumple_el_contrato(client: TestClient, auth: dict[str, str]) -> None:
    """[TC-PLATFORM-MLSERVICE-003] La respuesta real valida contra el JSON Schema publicado."""
    r = client.post("/v1/forecasts", json=load_example("request.valid.json"), headers=auth)
    assert r.status_code == 200
    schema = json.loads((CONTRACTS / "ml" / "forecast-response.v1.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(r.json(), schema)
    results = {x["ref"]: x for x in r.json()["results"]}
    assert [p["period"] for p in results["s1"]["points"]] == ["2026-11", "2026-12", "2027-01"]
    assert results["s2"]["model"]["selectedBy"] == "simple"


def test_ejemplos_invalidos_responden_400_sin_el_valor(client: TestClient, auth: dict[str, str]) -> None:
    """[TC-PLATFORM-MLSERVICE-003] Los ejemplos inválidos compartidos se rechazan con 400 sin eco de datos."""
    for name in ("request.invalid-extra-field.json", "request.invalid-horizon.json"):
        r = client.post("/v1/forecasts", json=load_example(name), headers=auth)
        assert r.status_code == 400, name
        assert r.json()["code"] == "INVALID_REQUEST"
        assert "4448" not in r.text


def test_cuerpo_demasiado_grande_responde_413(auth: dict[str, str]) -> None:
    """[TC-FORECAST-SERVICE-034] Un cuerpo mayor al límite se rechaza con 413."""
    with TestClient(create_app(Settings(token=SERVICE_TOKEN.encode(), max_body_bytes=200))) as c:
        r = c.post("/v1/forecasts", json=load_example("request.valid.json"), headers=auth)
        assert r.status_code == 413
        assert r.json()["code"] == "PAYLOAD_TOO_LARGE"


def test_limite_de_series_y_periodos(auth: dict[str, str]) -> None:
    """[TC-FORECAST-SERVICE-034] Los límites configurables de series y periodos se rechazan con 400."""
    with TestClient(create_app(Settings(token=SERVICE_TOKEN.encode(), max_series=1))) as c:
        r = c.post("/v1/forecasts", json=load_example("request.valid.json"), headers=auth)
        assert r.status_code == 400
    with TestClient(create_app(Settings(token=SERVICE_TOKEN.encode(), max_periods=2))) as c:
        r = c.post("/v1/forecasts", json=load_example("request.valid.json"), headers=auth)
        assert r.status_code == 400


def test_una_peticion_a_la_vez_responde_503_con_retry_after(auth: dict[str, str], monkeypatch: Any) -> None:
    """[TC-FORECAST-SERVICE-034] Con otra petición en curso la segunda recibe 503 con Retry-After."""
    import httpx

    started = asyncio.Event()
    release = asyncio.Event()
    real_to_thread = asyncio.to_thread

    async def gated(fn: Any, *a: Any, **k: Any) -> Any:
        started.set()
        await release.wait()
        return await real_to_thread(fn, *a, **k)

    async def run_both() -> tuple[int, int, str | None]:
        app = create_app(Settings(token=SERVICE_TOKEN.encode()))
        monkeypatch.setattr("finance_ml.app.asyncio.to_thread", gated)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            body = load_example("request.valid.json")
            first = asyncio.create_task(c.post("/v1/forecasts", json=body, headers=auth))
            await started.wait()
            second = await c.post("/v1/forecasts", json=body, headers=auth)
            release.set()
            done = await first
            return done.status_code, second.status_code, second.headers.get("retry-after")

    first_status, second_status, retry = asyncio.run(run_both())
    assert (first_status, second_status, retry) == (200, 503, "5")


def test_registros_sin_montos(client: TestClient, auth: dict[str, str], caplog: Any) -> None:
    """[TC-FORECAST-SERVICE-035] Los registros informan series, puntos y duración, sin ningún monto."""
    logging.getLogger("finance_ml").propagate = True
    with caplog.at_level(logging.INFO, logger="finance_ml"):
        r = client.post("/v1/forecasts", json=load_example("request.valid.json"), headers=auth)
    assert r.status_code == 200
    forecast_records = [x for x in caplog.records if getattr(x, "event", "") == "forecast"]
    assert len(forecast_records) >= 1
    rec = forecast_records[0]
    assert rec.series == 2
    assert rec.points == 5
    assert hasattr(rec, "durationMs")
    text = " ".join(f"{x.getMessage()} {x.__dict__}" for x in caplog.records)
    for amount in ("4448", "4350", "9500", "4100"):
        assert amount not in text
