"""Modelos `phase8-v1` (openspec add-expense-forecasts, decisiones 5 a 11 y 15).

Familia: `NAIVE`, `MEAN_LAST_N` (3, 6, 12), `SEASONAL_NAIVE` (>= 13 periodos), `ETS_DAMPED` (aditivo con
tendencia amortiguada, >= 6) y `ETS_SEASONAL` (aditivo, estacionalidad 12, >= 24). La selección es por
backtesting de origen móvil con ventana creciente (MASE ponderado 0.5 a 1 periodo y 0.5 a 3), sin fuga de datos:
el candidato de cada corte se ajusta solo con la historia anterior al corte. Un modelo que no es de referencia
se publica solo si su MASE es al menos `min_improvement` menor que el de la mejor referencia; si no, se publica
la referencia. Los intervalos de ETS salen de una simulación con semilla fija y los de las referencias, de los
errores empíricos a un paso. Sin aleatoriedad fuera de esa simulación: con la misma petición y la misma semilla
la respuesta es idéntica.

Todo se calcula sobre la parte VARIABLE de la historia (los conocidos los suma el sistema, nunca el modelo).
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .schemas import (
    BacktestCandidate,
    BacktestInfo,
    BaselineInfo,
    Drivers,
    ModelInfo,
    PointOut,
    ResultOut,
    SeriesIn,
)

MODEL_SET = "phase8-v1"
MODEL_VERSION = "1"
Z80 = 1.2815515655446004
Z95 = 1.959963984540054
MIN_EMPIRICAL_ERRORS = 6
MAD_LIMIT = 3.5
MAD_SCALE = 1.4826
MASE_CAP = 9999.9999
MIN_FOR_BACKTEST = 7  # con menos no hay cortes con la historia mínima (6)
MIN_TRAIN = 6

Arr = NDArray[np.float64]
Forecaster = Callable[[Arr, int], Arr]

REFERENCES = ("NAIVE", "MEAN_LAST_3", "MEAN_LAST_6", "MEAN_LAST_12", "SEASONAL_NAIVE")
ALL_MODELS = (*REFERENCES, "ETS_DAMPED", "ETS_SEASONAL")
_MIN_PERIODS = {
    "NAIVE": 1,
    "MEAN_LAST_3": 1,
    "MEAN_LAST_6": 1,
    "MEAN_LAST_12": 1,
    "SEASONAL_NAIVE": 13,
    "ETS_DAMPED": 6,
    "ETS_SEASONAL": 24,
}


@dataclass(frozen=True)
class Phase8Settings:
    max_origins: int = 6
    min_improvement: float = 0.05
    ets_simulations: int = 1000


def shift_period(period: str, months: int) -> str:
    year, month = int(period[:4]), int(period[5:7])
    index = year * 12 + (month - 1) + months
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def candidates_for(n: int) -> list[str]:
    """Candidatos que la historia de `n` periodos admite (decisión 5)."""
    return [name for name in ALL_MODELS if n >= _MIN_PERIODS[name]]


# ─────────────────────────────────────────────────────────────── atípicos (decisión 11)


def detect_outliers(values: Arr) -> tuple[list[int], Arr]:
    """Índices atípicos (|y - mediana| > 3.5 x 1.4826 x MAD, con >= 6 periodos) y la serie recortada al límite."""
    if len(values) < 6:
        return [], values.copy()
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    limit = MAD_LIMIT * MAD_SCALE * mad
    if mad == 0.0:
        return [], values.copy()
    clipped = np.clip(values, median - limit, median + limit)
    flagged = [i for i, v in enumerate(values) if abs(float(v) - median) > limit]
    return flagged, clipped


# ─────────────────────────────────────────────────────────────── pronosticadores de referencia


def _naive(hist: Arr, horizon: int) -> Arr:
    return np.full(horizon, hist[-1], dtype=np.float64)


def _mean_last(n: int) -> Forecaster:
    def f(hist: Arr, horizon: int) -> Arr:
        window = hist[-n:]
        return np.full(horizon, float(np.sum(window) / len(window)), dtype=np.float64)

    return f


def _seasonal_naive(hist: Arr, horizon: int) -> Arr:
    t = len(hist)
    out = np.empty(horizon, dtype=np.float64)
    for h in range(1, horizon + 1):
        idx = t + h - 13
        while idx >= t:
            idx -= 12
        out[h - 1] = hist[idx]
    return out


def _ets(model: str, hist: Arr) -> tuple[Any, float]:
    """Ajusta ETS aditivo (amortiguado o estacional); devuelve el resultado y el desvío de los residuos."""
    from statsmodels.tsa.exponential_smoothing.ets import ETSModel

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if model == "ETS_DAMPED":
            spec = ETSModel(hist, error="add", trend="add", damped_trend=True, seasonal=None)
        else:
            spec = ETSModel(hist, error="add", trend=None, seasonal="add", seasonal_periods=12)
        res = spec.fit(disp=False, maxiter=200)
    return res, math.sqrt(max(float(res.mse), 0.0))


def _ets_forecaster(model: str) -> Forecaster:
    def f(hist: Arr, horizon: int) -> Arr:
        res, _ = _ets(model, hist)
        return np.asarray(res.forecast(horizon), dtype=np.float64)

    return f


def forecaster(name: str) -> Forecaster:
    if name == "NAIVE":
        return _naive
    if name.startswith("MEAN_LAST_"):
        return _mean_last(int(name.rsplit("_", 1)[1]))
    if name == "SEASONAL_NAIVE":
        return _seasonal_naive
    return _ets_forecaster(name)


def _one_step_errors(name: str, hist: Arr) -> list[float]:
    """Errores fuera de muestra a un paso de una referencia, con su propia historia mínima."""
    start = _MIN_PERIODS[name]
    f = forecaster(name)
    return [float(hist[t] - f(hist[:t], 1)[0]) for t in range(start, len(hist))]


def _spread(errors: list[float]) -> tuple[bool, list[float], float]:
    """(¿empírico?, cuantiles [2.5, 10, 90, 97.5] %, desvío)."""
    sd = float(np.std(errors, ddof=1)) if len(errors) >= 2 else 0.0
    if len(errors) >= MIN_EMPIRICAL_ERRORS:
        q = [float(x) for x in np.quantile(np.array(errors), [0.025, 0.1, 0.9, 0.975])]
        return True, q, sd
    return False, [], sd


def _bounds(base: float, h: int, empirical: bool, q: list[float], sd: float) -> tuple[float, float, float, float]:
    """(lower95, lower80, upper80, upper95) alrededor de `base` para el horizonte h."""
    root = math.sqrt(h)
    if empirical:
        lo95, lo80, hi80, hi95 = (x * root for x in q)
    else:
        lo80, hi80 = -Z80 * sd * root, Z80 * sd * root
        lo95, hi95 = -Z95 * sd * root, Z95 * sd * root
    return base + lo95, base + lo80, base + hi80, base + hi95


# ─────────────────────────────────────────────────────────────── backtesting (decisión 6)


def naive_scale(train: Arr) -> float:
    """MAE del ingenuo en la muestra de entrenamiento (estacional si hay >= 24 periodos)."""
    seasonal = len(train) >= 24
    lag = 12 if seasonal else 1
    diffs = np.abs(train[lag:] - train[:-lag])
    scale = float(np.mean(diffs)) if len(diffs) else 0.0
    return max(scale, 1e-6)


@dataclass
class _CandidateScore:
    name: str
    origins: int
    mase: float | None
    coverage80: float | None
    bias: float | None


def backtest_origins(n: int, max_origins: int) -> list[int]:
    """Índices (0-based) de los cortes: los últimos K = min(max_origins, n - 6) periodos."""
    k = min(max_origins, n - MIN_TRAIN)
    return list(range(n - k, n)) if k > 0 else []


def _interval_at_cut(name: str, train: Arr) -> tuple[float, float, float]:
    """(pronóstico a 1 paso, límite inferior 80, superior 80) con solo la historia de entrenamiento."""
    if name.startswith("ETS"):
        res, sigma = _ets(name, train)
        point = float(np.asarray(res.forecast(1))[0])
        return point, point - Z80 * sigma, point + Z80 * sigma
    f = forecaster(name)
    point = float(f(train, 1)[0])
    errors = _one_step_errors(name, train)
    empirical, q, sd = _spread(errors)
    _, lo80, hi80, _ = _bounds(point, 1, empirical, q, sd)
    return point, lo80, hi80


def run_backtest(values: Arr, names: list[str], max_origins: int) -> tuple[list[int], list[_CandidateScore]]:
    """Origen móvil con ventana creciente. En cada corte t cada candidato se ajusta con `values[:t]` (sin ningún dato
    >= t) y pronostica t y t+2. Un candidato se evalúa solo en los cortes donde su historia mínima lo permite."""
    n = len(values)
    cuts = backtest_origins(n, max_origins)
    scores: list[_CandidateScore] = []
    for name in names:
        e1: list[float] = []
        e3: list[float] = []
        covered: list[float] = []
        signed: list[float] = []
        used = 0
        for t in cuts:
            train = values[:t]
            if len(train) < _MIN_PERIODS[name]:
                continue
            scale = naive_scale(train)
            horizon = 3 if t + 2 < n else 1
            fc = forecaster(name)(train, horizon)
            used += 1
            e1.append(abs(float(values[t] - fc[0])) / scale)
            if horizon == 3:
                e3.append(abs(float(values[t + 2] - fc[2])) / scale)
            point, lo80, hi80 = _interval_at_cut(name, train)
            covered.append(1.0 if lo80 <= float(values[t]) <= hi80 else 0.0)
            signed.append((point - float(values[t])) / scale)
        if used == 0:
            scores.append(_CandidateScore(name, 0, None, None, None))
            continue
        h1 = float(np.mean(e1))
        mase = 0.5 * h1 + 0.5 * float(np.mean(e3)) if e3 else h1
        scores.append(
            _CandidateScore(
                name,
                used,
                min(mase, MASE_CAP),
                float(np.mean(covered)),
                float(np.mean(signed)),
            )
        )
    return cuts, scores


def select_model(
    scores: list[_CandidateScore], full_origins: int, min_improvement: float
) -> tuple[str, str, float | None]:
    """Devuelve (modelo publicado, `BACKTEST` | `BASELINE_FALLBACK`, MASE de la mejor referencia).

    Solo compiten los candidatos evaluados en TODOS los cortes (comparación justa). La mejor referencia es la de
    menor MASE (a igualdad, el orden de `REFERENCES`); un modelo no de referencia se publica si su MASE es
    como mucho (1 - mejora) veces la de ella."""
    eligible = [s for s in scores if s.origins == full_origins and s.mase is not None]
    refs = [s for s in eligible if s.name in REFERENCES]
    best_ref = min(refs, key=lambda s: (s.mase if s.mase is not None else math.inf, REFERENCES.index(s.name)))
    others = [s for s in eligible if s.name not in REFERENCES and s.mase is not None]
    ref_mase = best_ref.mase if best_ref.mase is not None else math.inf
    winners = [s for s in others if s.mase is not None and s.mase <= (1.0 - min_improvement) * ref_mase]
    if winners:
        best = min(winners, key=lambda s: (s.mase if s.mase is not None else math.inf, s.name))
        return best.name, "BACKTEST", ref_mase
    return best_ref.name, "BASELINE_FALLBACK", ref_mase


# ─────────────────────────────────────────────────────────────── salida


def _q(value: float, scale: int, *, floor: bool = False) -> Decimal:
    q = Decimal(1).scaleb(-scale)
    out = Decimal(value).quantize(q, rounding=ROUND_HALF_EVEN)
    if floor and out < 0:
        return Decimal(0).quantize(q)
    return out


def _fmt(value: Decimal) -> str:
    return format(value, "f")


def _error(ref: str, code: str) -> ResultOut:
    return ResultOut(ref=ref, status="ERROR", error=code, model=None, baseline=None, points=[])


def _fit_and_project(
    name: str, fit_values: Arr, horizon: int, seed: int, simulations: int
) -> tuple[Arr, list[tuple[float, float, float, float]], Arr | None]:
    """Pronóstico puntual, límites (lower95, lower80, upper80, upper95) por horizonte y, con `ETS_SEASONAL`, el
    componente estacional por horizonte."""
    if name.startswith("ETS"):
        res, _ = _ets(name, fit_values)
        point = np.asarray(res.forecast(horizon), dtype=np.float64)
        rng = np.random.default_rng(seed)
        sim = np.asarray(
            res.simulate(nsimulations=horizon, anchor="end", repetitions=simulations, rng=rng),
            dtype=np.float64,
        ).reshape(horizon, -1)
        q = np.quantile(sim, [0.025, 0.1, 0.9, 0.975], axis=1)
        bounds = [(float(q[0, h]), float(q[1, h]), float(q[2, h]), float(q[3, h])) for h in range(horizon)]
        seasonal: Arr | None = None
        if name == "ETS_SEASONAL":
            season = np.asarray(res.season, dtype=np.float64)
            t = len(fit_values)
            seasonal = np.array([season[t + h - 13] for h in range(1, horizon + 1)], dtype=np.float64)
        return point, bounds, seasonal
    f = forecaster(name)
    point = f(fit_values, horizon)
    empirical, qs, sd = _spread(_one_step_errors(name, fit_values))
    bounds = [_bounds(float(point[h - 1]), h, empirical, qs, sd) for h in range(1, horizon + 1)]
    return point, bounds, None


def _result(
    series: SeriesIn,
    *,
    name: str,
    selected_by: str,
    values: Arr,
    fit_values: Arr,
    outliers: list[str],
    backtest: BacktestInfo | None,
    seed: int,
    simulations: int,
) -> ResultOut:
    scale = series.scale
    horizon = series.horizon
    periods = [p.period for p in series.points]
    point, bounds, seasonal = _fit_and_project(name, fit_values, horizon, seed, simulations)
    base_n = min(6, len(values))
    base = float(np.sum(values[-base_n:]) / base_n)
    average = _q(base, scale)
    out: list[PointOut] = []
    for h in range(1, horizon + 1):
        pred_f = max(float(point[h - 1]), 0.0)
        lo95, lo80, hi80, hi95 = bounds[h - 1]
        lower80 = max(min(lo80, pred_f), 0.0)
        upper80 = max(hi80, pred_f)
        lower95 = max(min(lo95, lower80), 0.0)
        upper95 = max(hi95, upper80)
        pred = _q(pred_f, scale, floor=True)
        l80, u80, l95, u95 = (_q(x, scale, floor=True) for x in (lower80, upper80, lower95, upper95))
        # Orden garantizado también tras cuantizar.
        l80, u80 = min(l80, pred), max(u80, pred)
        l95, u95 = min(l95, l80), max(u95, u80)
        season_q = _q(float(seasonal[h - 1]), scale) if seasonal is not None else None
        trend = pred - average - (season_q if season_q is not None else Decimal(0))
        out.append(
            PointOut(
                period=shift_period(periods[-1], h),
                monthsAhead=h,
                prediction=_fmt(pred),
                lower80=_fmt(l80),
                upper80=_fmt(u80),
                lower95=_fmt(l95),
                upper95=_fmt(u95),
                baselineValue=_fmt(_q(max(base, 0.0), scale, floor=True)),
                drivers=Drivers(
                    historicalAverage=_fmt(average),
                    seasonality=_fmt(season_q) if season_q is not None else None,
                    trendAndLevel=_fmt(trend),
                ),
            )
        )
    return ResultOut(
        ref=series.ref,
        status="OK",
        error=None,
        model=ModelInfo(name=name, version=MODEL_VERSION, selectedBy=selected_by),  # type: ignore[arg-type]
        baseline=BaselineInfo(method="MEAN_LAST_N", n=base_n),
        points=out,
        backtest=backtest,
        outliers=outliers,
    )


def forecast_series_phase8(series: SeriesIn, seed: int, settings: Phase8Settings | None = None) -> ResultOut:
    cfg = settings or Phase8Settings()
    values = np.array([float(Decimal(p.value)) for p in series.points], dtype=np.float64)
    periods = [p.period for p in series.points]
    if not np.all(np.isfinite(values)):
        return _error(series.ref, "NON_FINITE_INPUT")
    if periods != sorted(set(periods)):
        return _error(series.ref, "PERIODS_NOT_ASCENDING")
    n = len(values)
    # Semilla propia por serie: independiente del orden y de las demás series de la petición.
    series_seed = (seed * 1_000_003 + int(series.ref[1:])) % 2_147_483_647
    flagged: list[int] = []
    fit_values = values
    if series.outlierPolicy == "MAD_3_5":
        flagged, fit_values = detect_outliers(values)
    outliers = [periods[i] for i in flagged]
    if series.readiness == "SIMPLE" or n < MIN_FOR_BACKTEST:
        return _result(
            series,
            name="MEAN_LAST_6",
            selected_by="SIMPLE",
            values=values,
            fit_values=fit_values,
            outliers=outliers,
            backtest=None,
            seed=series_seed,
            simulations=cfg.ets_simulations,
        )
    names = candidates_for(n)
    cuts, scores = run_backtest(fit_values, names, cfg.max_origins)
    chosen, selected_by, ref_mase = select_model(scores, len(cuts), cfg.min_improvement)
    info = BacktestInfo(
        origins=[periods[t] for t in cuts],
        candidates=[
            BacktestCandidate(
                name=s.name,
                cuts=s.origins,
                mase=None if s.mase is None else f"{s.mase:.4f}",
                coverage80=None if s.coverage80 is None else f"{s.coverage80:.4f}",
                bias=None if s.bias is None else f"{s.bias:.4f}",
            )
            for s in scores
        ],
        selected=chosen,
        fallback=selected_by == "BASELINE_FALLBACK",
        baselineMase=None if ref_mase is None else f"{ref_mase:.4f}",
    )
    return _result(
        series,
        name=chosen,
        selected_by=selected_by,
        values=values,
        fit_values=fit_values,
        outliers=outliers,
        backtest=info,
        seed=series_seed,
        simulations=cfg.ets_simulations,
    )
