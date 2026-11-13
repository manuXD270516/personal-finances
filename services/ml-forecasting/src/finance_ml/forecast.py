"""Pronósticos de referencia (baseline-v1): último periodo, mismo periodo del año anterior y promedio móvil.

El valor esperado publicado es el promedio móvil de los últimos 6 periodos (o de los disponibles). Los intervalos
del 80 % y del 95 % salen de los errores fuera de muestra a 1 paso del mismo método (escalados por la raíz de h
para h > 1) y, con menos de 6 errores, de media más/menos z por el desvío (marcados `simple`). Los resultados se
cuantizan con Decimal ROUND_HALF_EVEN a la escala de la moneda y los negativos se truncan a 0. Sin aleatoriedad:
la semilla se acepta por contrato y estos modelos no la usan.
"""

from __future__ import annotations

import math
from decimal import ROUND_HALF_EVEN, Decimal

import numpy as np

from .schemas import BaselineInfo, ModelInfo, PointOut, ResultOut, SeriesIn

MODEL_NAME = "mean_last_n"
MODEL_VERSION = "1"
MIN_EMPIRICAL_ERRORS = 6
Z80 = 1.2815515655446004
Z95 = 1.959963984540054


def shift_period(period: str, months: int) -> str:
    year, month = int(period[:4]), int(period[5:7])
    index = year * 12 + (month - 1) + months
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def naive(values: list[float]) -> float:
    """Último periodo."""
    return values[-1]


def mean_last_n(values: list[float], n: int) -> float:
    """Promedio de los últimos `n` periodos (o de los disponibles)."""
    window = values[-n:]
    return float(sum(window) / len(window))


def seasonal_naive(values: list[float], step: int) -> float | None:
    """Mismo periodo del año anterior para `step` periodos adelante; requiere al menos 13 periodos."""
    if len(values) < 13:
        return None
    idx = len(values) + step - 1 - 12
    while idx >= len(values):
        idx -= 12
    return values[idx]


def one_step_errors(values: list[float], n: int) -> list[float]:
    """Errores fuera de muestra a 1 paso del promedio móvil de `n` periodos."""
    return [values[t] - mean_last_n(values[:t], n) for t in range(1, len(values))]


def _quantize(value: float, scale: int) -> Decimal:
    q = Decimal(1).scaleb(-scale)
    quantized = Decimal(value).quantize(q, rounding=ROUND_HALF_EVEN)
    return quantized if quantized >= 0 else Decimal(0).quantize(q)


def _fmt(value: Decimal) -> str:
    return format(value, "f")


def _error(ref: str, code: str) -> ResultOut:
    return ResultOut(ref=ref, status="ERROR", error=code, model=None, baseline=None, points=[])


def forecast_series(series: SeriesIn) -> ResultOut:
    values = [float(Decimal(p.value)) for p in series.points]
    periods = [p.period for p in series.points]
    if any(not math.isfinite(v) for v in values):
        return _error(series.ref, "NON_FINITE_INPUT")
    if periods != sorted(set(periods)):
        return _error(series.ref, "PERIODS_NOT_ASCENDING")
    n = min(6, len(values))
    base = mean_last_n(values, n)
    errors = one_step_errors(values, 6)
    empirical = len(errors) >= MIN_EMPIRICAL_ERRORS and series.readiness == "MODEL"
    sd = float(np.std(errors, ddof=1)) if len(errors) >= 2 else 0.0
    quantiles = [float(x) for x in np.quantile(np.array(errors), [0.025, 0.1, 0.9, 0.975])] if empirical else []
    points: list[PointOut] = []
    for h in range(1, series.horizon + 1):
        root = math.sqrt(h)
        if empirical:
            lo95, lo80, hi80, hi95 = (x * root for x in quantiles)
        else:
            lo80, hi80 = -Z80 * sd * root, Z80 * sd * root
            lo95, hi95 = -Z95 * sd * root, Z95 * sd * root
        lower80 = max(min(base + lo80, base), 0.0)
        upper80 = max(base + hi80, base)
        lower95 = max(min(base + lo95, lower80), 0.0)
        upper95 = max(base + hi95, upper80)
        pred, l80, u80, l95, u95, ref_value = (
            _quantize(x, series.scale) for x in (max(base, 0.0), lower80, upper80, lower95, upper95, max(base, 0.0))
        )
        points.append(
            PointOut(
                period=shift_period(periods[-1], h),
                monthsAhead=h,
                prediction=_fmt(pred),
                lower80=_fmt(l80),
                upper80=_fmt(u80),
                lower95=_fmt(l95),
                upper95=_fmt(u95),
                baselineValue=_fmt(ref_value),
            )
        )
    return ResultOut(
        ref=series.ref,
        status="OK",
        error=None,
        model=ModelInfo(name=MODEL_NAME, version=MODEL_VERSION, selectedBy="fixed" if empirical else "simple"),
        baseline=BaselineInfo(method="MEAN_LAST_N", n=n),
        points=points,
    )
