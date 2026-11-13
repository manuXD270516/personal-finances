"""Rendimiento de phase8-v1 (openspec add-expense-forecasts, TC-FORECAST-EXPENSE-023).

Corre solo en el benchmark nocturno (`uv run pytest -m perf`): el PR omite estas pruebas por su duración
(marcador `perf`, excluido por omisión en `pyproject.toml`).
"""

from __future__ import annotations

import time

import numpy as np
import pytest

from finance_ml.phase8 import Phase8Settings, forecast_series_phase8, shift_period
from finance_ml.schemas import SeriesIn, SeriesPoint

pytestmark = pytest.mark.perf

# Conjunto Large del PRD: ~60 series (totales, grupos y categorías) con 36 periodos de historia y horizonte de 12.
SERIES = 60
PERIODS = 36
BUDGET_SECONDS = 300.0


def synthetic(index: int) -> SeriesIn:
    rng = np.random.default_rng(index)
    values = 800 + 40 * index + 150 * np.sin(2 * np.pi * np.arange(PERIODS) / 12) + rng.normal(0, 25, PERIODS)
    return SeriesIn(
        ref=f"s{index + 1}",
        kind="EXPENSE",
        currency="BOB",
        scale=2,
        readiness="MODEL",
        horizon=12,
        outlierPolicy="MAD_3_5",
        points=[
            SeriesPoint(period=shift_period("2023-11", i), value=f"{max(float(v), 0.0):.2f}", txCount=12)
            for i, v in enumerate(values)
        ],
    )


def test_corrida_de_60_series_con_backtesting_en_300_s_o_menos() -> None:
    """[TC-FORECAST-EXPENSE-023] La corrida con modelos y backtesting del conjunto Large termina en 300 s o menos."""
    cfg = Phase8Settings(max_origins=6, min_improvement=0.05, ets_simulations=1000)
    started = time.perf_counter()
    results = [forecast_series_phase8(synthetic(i), 42, cfg) for i in range(SERIES)]
    elapsed = time.perf_counter() - started
    assert all(r.status == "OK" for r in results)
    assert elapsed <= BUDGET_SECONDS, f"{elapsed:.1f} s excede el presupuesto de {BUDGET_SECONDS:.0f} s"
