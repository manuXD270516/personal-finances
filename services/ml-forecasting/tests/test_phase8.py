from __future__ import annotations

import json
from decimal import Decimal

import jsonschema
import numpy as np
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from finance_ml.phase8 import (
    Phase8Settings,
    _CandidateScore,
    backtest_origins,
    candidates_for,
    detect_outliers,
    forecast_series_phase8,
    forecaster,
    run_backtest,
    select_model,
    shift_period,
)
from finance_ml.schemas import ForecastResponseV1, SeriesIn, SeriesPoint

from .conftest import CONTRACTS, load_example

RESPONSE_SCHEMA = json.loads((CONTRACTS / "ml" / "forecast-response.v1.schema.json").read_text(encoding="utf-8"))
REQUEST_SCHEMA = json.loads((CONTRACTS / "ml" / "forecast-request.v1.schema.json").read_text(encoding="utf-8"))
FAST = Phase8Settings(max_origins=6, min_improvement=0.05, ets_simulations=200)


def make(values: list[float], *, horizon: int = 3, ref: str = "s1", outliers: bool = False) -> SeriesIn:
    periods = [shift_period("2024-01", i) for i in range(len(values))]
    return SeriesIn(
        ref=ref,
        kind="EXPENSE",
        currency="BOB",
        scale=2,
        readiness="MODEL" if len(values) >= 6 else "SIMPLE",
        horizon=horizon,
        points=[SeriesPoint(period=p, value=f"{v:.2f}", txCount=9) for p, v in zip(periods, values, strict=True)],
        outlierPolicy="MAD_3_5" if outliers else None,
    )


def seasonal_values(n: int, seed: int = 1) -> list[float]:
    rng = np.random.default_rng(seed)
    return [float(1000 + 200 * np.sin(2 * np.pi * i / 12) + rng.normal(0, 20)) for i in range(n)]


def test_candidatos_con_14_periodos_excluyen_el_estacional() -> None:
    """[TC-FORECAST-EXPENSE-008] Con 14 periodos los candidatos excluyen el suavizado estacional."""
    assert candidates_for(14) == [
        "NAIVE",
        "MEAN_LAST_3",
        "MEAN_LAST_6",
        "MEAN_LAST_12",
        "SEASONAL_NAIVE",
        "ETS_DAMPED",
    ]
    assert "ETS_SEASONAL" in candidates_for(24)
    assert "SEASONAL_NAIVE" not in candidates_for(12)
    assert "ETS_DAMPED" not in candidates_for(5)


def test_cortes_de_una_serie_de_10_periodos() -> None:
    """[TC-FORECAST-EXPENSE-009] Los cortes son 2026-07..2026-10 y el primero entrena solo con 2026-01..2026-06."""
    cuts = backtest_origins(10, 6)
    periods = [shift_period("2026-01", i) for i in range(10)]
    assert [periods[t] for t in cuts] == ["2026-07", "2026-08", "2026-09", "2026-10"]
    assert cuts[0] == 6  # entrenamiento = values[:6] = 2026-01..2026-06


def test_sin_fuga_de_datos_posteriores_al_corte() -> None:
    """[TC-FORECAST-EXPENSE-009] Alterar un dato posterior al corte no cambia el pronóstico desde ese corte."""
    base = np.array(seasonal_values(12), dtype=np.float64)
    changed = base.copy()
    changed[10:] = 99999.0
    for name in ("NAIVE", "MEAN_LAST_6", "ETS_DAMPED"):
        f = forecaster(name)
        assert np.allclose(f(base[:8], 3), f(changed[:8], 3))
    cuts, scores = run_backtest(base, ["NAIVE", "MEAN_LAST_3"], 6)
    assert cuts == [6, 7, 8, 9, 10, 11]
    assert all(s.origins == 6 for s in scores)


def test_publica_el_modelo_que_mejora_al_menos_5_por_ciento() -> None:
    """[TC-FORECAST-EXPENSE-010] ETS 0.78 contra la mejor referencia 0.90: se publica el suavizado exponencial."""
    scores = [
        _CandidateScore("NAIVE", 6, 1.2, 0.8, 0.0),
        _CandidateScore("MEAN_LAST_6", 6, 0.90, 0.8, 0.0),
        _CandidateScore("ETS_DAMPED", 6, 0.78, 0.8, 0.0),
    ]
    assert select_model(scores, 6, 0.05) == ("ETS_DAMPED", "BACKTEST", 0.90)


def test_con_mejora_menor_al_5_por_ciento_se_publica_la_referencia() -> None:
    """[TC-FORECAST-EXPENSE-011] ETS 0.88 contra 0.90 (0.95 x 0.90 = 0.855): se publica la referencia."""
    scores = [
        _CandidateScore("MEAN_LAST_6", 6, 0.90, 0.8, 0.0),
        _CandidateScore("ETS_DAMPED", 6, 0.88, 0.8, 0.0),
    ]
    assert select_model(scores, 6, 0.05) == ("MEAN_LAST_6", "BASELINE_FALLBACK", 0.90)


def test_un_candidato_parcial_no_compite() -> None:
    """[TC-FORECAST-EXPENSE-011] Un candidato evaluado en menos cortes que los demás no se puede publicar."""
    scores = [
        _CandidateScore("MEAN_LAST_6", 6, 0.90, 0.8, 0.0),
        _CandidateScore("SEASONAL_NAIVE", 1, 0.10, 1.0, 0.0),
    ]
    assert select_model(scores, 6, 0.05)[0] == "MEAN_LAST_6"


def test_los_motivos_suman_exactamente_la_prediccion_variable() -> None:
    """[TC-FORECAST-EXPENSE-012] promedio + estacionalidad + tendencia = predicción, con y sin modelo estacional."""
    for n in (14, 36):
        result = forecast_series_phase8(make(seasonal_values(n), horizon=6), 42, FAST)
        assert result.status == "OK"
        for p in result.points:
            assert p.drivers is not None
            total = (
                Decimal(p.drivers.historicalAverage)
                + Decimal(p.drivers.seasonality or "0")
                + Decimal(p.drivers.trendAndLevel)
            )
            assert total == Decimal(p.prediction)


def test_motivos_con_estacionalidad_solo_con_el_modelo_estacional() -> None:
    """[TC-FORECAST-EXPENSE-012] La estacionalidad solo se informa cuando se publica ETS_SEASONAL."""
    result = forecast_series_phase8(make(seasonal_values(48, 7), horizon=6), 42, FAST)
    assert result.model is not None
    for p in result.points:
        assert p.drivers is not None
        assert (p.drivers.seasonality is not None) == (result.model.name == "ETS_SEASONAL")


def test_un_periodo_atipico_se_senala_sin_cambiar_la_historia() -> None:
    """[TC-FORECAST-EXPENSE-022] 2024-07 con 4800.00 entre periodos de 300 a 500 se señala como atípico."""
    values = [320.0, 410.0, 380.0, 450.0, 300.0, 360.0, 4800.0, 420.0, 340.0, 500.0, 390.0, 430.0]
    series = make(values, outliers=True)
    result = forecast_series_phase8(series, 42, FAST)
    assert result.outliers == ["2024-07"]
    assert series.points[6].value == "4800.00"  # la historia enviada no se modifica
    flagged, clipped = detect_outliers(np.array(values))
    assert flagged == [6]
    assert float(clipped[6]) < 4800.0
    assert forecast_series_phase8(make(values), 42, FAST).outliers == []


def test_con_menos_de_7_periodos_se_publica_la_referencia_simple() -> None:
    """[TC-FORECAST-EXPENSE-010] Sin cortes posibles se publica la referencia con selectedBy SIMPLE y sin backtest."""
    result = forecast_series_phase8(make([100.0, 110.0, 120.0, 130.0, 125.0, 118.0]), 42, FAST)
    assert result.model is not None
    assert result.model.selectedBy == "SIMPLE"
    assert result.backtest is None


def test_el_backtest_guarda_mase_cobertura_y_sesgo() -> None:
    """[TC-FORECAST-EXPENSE-009] Cada candidato informa MASE, cobertura del 80 % y sesgo; hay un seleccionado."""
    result = forecast_series_phase8(make(seasonal_values(14), horizon=3), 42, FAST)
    assert result.backtest is not None
    names = [c.name for c in result.backtest.candidates]
    assert "ETS_SEASONAL" not in names
    assert "ETS_DAMPED" in names
    assert result.backtest.selected in names
    full = [c for c in result.backtest.candidates if c.cuts == len(result.backtest.origins)]
    assert full
    assert all(c.mase is not None and c.coverage80 is not None and c.bias is not None for c in full)


def test_misma_peticion_misma_semilla_mismos_resultados() -> None:
    """[TC-FORECAST-EXPENSE-021] Dos ejecuciones con la semilla 42 dan los mismos valores e intervalos."""
    series = make(seasonal_values(30), horizon=12)
    first = forecast_series_phase8(series, 42, FAST)
    second = forecast_series_phase8(series, 42, FAST)
    assert first.model_dump() == second.model_dump()


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    values=st.lists(st.floats(min_value=0, max_value=50_000, allow_nan=False), min_size=7, max_size=26),
    seed=st.integers(min_value=0, max_value=2_147_483_647),
)
def test_propiedad_intervalos_ordenados_y_determinismo(values: list[float], seed: int) -> None:
    """[TC-FORECAST-EXPENSE-021] Intervalos ordenados, no negativos y deterministas con la semilla."""
    series = make(values, horizon=3)
    a = forecast_series_phase8(series, seed, FAST)
    b = forecast_series_phase8(series, seed, FAST)
    assert a.model_dump() == b.model_dump()
    assert a.status == "OK"
    for p in a.points:
        lo95, lo80, pred, hi80, hi95 = (Decimal(x) for x in (p.lower95, p.lower80, p.prediction, p.upper80, p.upper95))
        assert 0 <= lo95 <= lo80 <= pred <= hi80 <= hi95


def test_api_phase8_cumple_el_contrato_y_los_ejemplos(client: TestClient, auth: dict[str, str]) -> None:
    """[TC-FORECAST-EXPENSE-021] La respuesta de phase8-v1 valida contra el JSON Schema y el modelo."""
    body = load_example("request.phase8.valid.json")
    jsonschema.validate(body, REQUEST_SCHEMA)
    r = client.post("/v1/forecasts", json=body, headers=auth)
    assert r.status_code == 200
    jsonschema.validate(r.json(), RESPONSE_SCHEMA)
    ForecastResponseV1.model_validate(r.json())
    again = client.post("/v1/forecasts", json=body, headers=auth).json()
    assert [x["points"] for x in r.json()["results"]] == [x["points"] for x in again["results"]]
    ok = load_example("response.phase8.valid.json")
    jsonschema.validate(ok, RESPONSE_SCHEMA)
    ForecastResponseV1.model_validate(ok)
