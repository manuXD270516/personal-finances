from __future__ import annotations

from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from finance_ml.forecast import forecast_series, mean_last_n, naive, one_step_errors, seasonal_naive, shift_period
from finance_ml.schemas import SeriesIn, SeriesPoint


def make_series(values: list[str], *, horizon: int = 6, scale: int = 2, readiness: str = "MODEL") -> SeriesIn:
    periods = [shift_period("2025-01", i) for i in range(len(values))]
    return SeriesIn(
        ref="s1",
        kind="EXPENSE",
        currency="BOB",
        scale=scale,
        readiness=readiness,  # type: ignore[arg-type]
        horizon=horizon,
        points=[SeriesPoint(period=p, value=v, txCount=5) for p, v in zip(periods, values, strict=True)],
    )


def test_metodos_de_referencia() -> None:
    """[TC-PLATFORM-MLSERVICE-004] NAIVE, SEASONAL_NAIVE y MEAN_LAST_N de referencia."""
    values = [float(i) for i in range(1, 15)]
    assert naive(values) == 14.0
    assert mean_last_n(values, 3) == 13.0
    assert mean_last_n([1.0, 2.0], 6) == 1.5
    assert seasonal_naive(values[:12], 1) is None
    assert seasonal_naive(values, 1) == values[len(values) - 12]
    assert len(one_step_errors(values, 6)) == len(values) - 1


def test_cuantizacion_half_even_a_la_escala() -> None:
    """[TC-PLATFORM-MLSERVICE-004] Los montos se cuantizan a la escala con HALF_EVEN y nunca son negativos."""
    result = forecast_series(make_series(["2.5", "2.5", "2.5"], scale=0, horizon=1, readiness="SIMPLE"))
    assert result.points[0].prediction == "2"  # HALF_EVEN: 2.5 -> 2
    neg = forecast_series(make_series(["-10.00", "-20.00", "-30.00"], horizon=1, readiness="SIMPLE"))
    assert neg.points[0].prediction == "0.00"


def test_intervalo_simple_con_pocos_errores() -> None:
    """[TC-PLATFORM-MLSERVICE-004] Con menos de 6 errores el intervalo es media más/menos z por el desvío (simple)."""
    result = forecast_series(make_series(["100.00", "120.00", "110.00", "130.00"], horizon=2))
    assert result.model is not None and result.model.selectedBy == "simple"
    p1, p2 = result.points
    assert Decimal(p2.upper80) - Decimal(p2.prediction) > Decimal(p1.upper80) - Decimal(p1.prediction)


def test_determinismo() -> None:
    """[TC-PLATFORM-MLSERVICE-004] Mismos datos, mismo resultado."""
    s = make_series([f"{100 + (i * 37) % 23}.00" for i in range(24)], horizon=12)
    assert forecast_series(s) == forecast_series(s)


values_strategy = st.lists(
    st.decimals(min_value=Decimal("-500"), max_value=Decimal("100000"), places=2, allow_nan=False),
    min_size=3,
    max_size=60,
)


@settings(max_examples=200, deadline=None)
@given(values=values_strategy, horizon=st.integers(min_value=1, max_value=12), scale=st.integers(0, 4))
def test_propiedad_intervalos_ordenados_y_no_negativos(values: list[Decimal], horizon: int, scale: int) -> None:
    """[TC-PLATFORM-MLSERVICE-004] Intervalos ordenados, no negativos, en la escala y con el periodo correcto."""
    series = make_series([format(v, "f") for v in values], horizon=horizon, scale=scale)
    result = forecast_series(series)
    assert result.status == "OK"
    assert len(result.points) == horizon
    last = series.points[-1].period
    for i, p in enumerate(result.points, start=1):
        assert p.period == shift_period(last, i)
        l95, l80, pred, u80, u95 = (Decimal(x) for x in (p.lower95, p.lower80, p.prediction, p.upper80, p.upper95))
        assert 0 <= l95 <= l80 <= pred <= u80 <= u95
        for text in (p.lower95, p.lower80, p.prediction, p.upper80, p.upper95, p.baselineValue):
            exponent = Decimal(text).as_tuple().exponent
            assert exponent == -scale or (scale == 0 and "." not in text)
        assert forecast_series(series) == result
