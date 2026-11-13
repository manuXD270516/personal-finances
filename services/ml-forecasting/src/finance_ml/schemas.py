"""Contrato interno v1 (contracts/ml/*.schema.json): petición y respuesta del pronóstico."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Period = Annotated[str, StringConstraints(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")]
DecimalString = Annotated[str, StringConstraints(pattern=r"^-?[0-9]+(\.[0-9]+)?$", max_length=40)]
Ref = Annotated[str, StringConstraints(pattern=r"^s[1-9][0-9]{0,3}$")]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z0-9]{2,16}$")]
Uuid = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Policy(_Strict):
    modelSet: Literal["baseline-v1", "phase8-v1"]  # noqa: N815
    horizonMax: int = Field(ge=1, le=12)  # noqa: N815
    intervalLevels: list[float] = Field(min_length=2, max_length=2)  # noqa: N815


class SeriesPoint(_Strict):
    period: Period
    value: DecimalString
    txCount: int = Field(ge=0, le=1_000_000)  # noqa: N815


class SeriesIn(_Strict):
    ref: Ref
    kind: Literal["EXPENSE", "INCOME"]
    currency: Currency
    scale: int = Field(ge=0, le=8)
    readiness: Literal["MODEL", "SIMPLE"]
    horizon: int = Field(ge=1, le=12)
    points: list[SeriesPoint] = Field(min_length=1, max_length=120)
    # Aditivo (phase8-v1): política de atípicos de la parte variable.
    outlierPolicy: Literal["MAD_3_5"] | None = None  # noqa: N815


class ForecastRequestV1(_Strict):
    schemaVersion: Literal["1"]  # noqa: N815
    requestId: Uuid  # noqa: N815
    seed: int = Field(ge=0, le=2_147_483_647)
    policy: Policy
    series: list[SeriesIn] = Field(min_length=1, max_length=400)


class ModelInfo(_Strict):
    name: str
    version: str
    selectedBy: Literal["fixed", "simple", "BACKTEST", "BASELINE_FALLBACK", "SIMPLE"]  # noqa: N815


class BaselineInfo(_Strict):
    method: Literal["NAIVE", "SEASONAL_NAIVE", "MEAN_LAST_N"]
    n: int | None


class Drivers(_Strict):
    """Motivos de la parte variable de un punto: promedio + estacionalidad + tendencia y nivel = predicción."""

    historicalAverage: DecimalString  # noqa: N815
    seasonality: DecimalString | None
    trendAndLevel: DecimalString  # noqa: N815


class BacktestCandidate(_Strict):
    name: str
    cuts: int = Field(ge=0)
    mase: DecimalString | None
    coverage80: DecimalString | None  # noqa: N815
    bias: DecimalString | None


class BacktestInfo(_Strict):
    origins: list[Period]
    candidates: list[BacktestCandidate]
    selected: str
    fallback: bool
    baselineMase: DecimalString | None  # noqa: N815


class PointOut(_Strict):
    period: Period
    monthsAhead: int = Field(ge=1, le=12)  # noqa: N815
    prediction: DecimalString
    lower80: DecimalString
    upper80: DecimalString
    lower95: DecimalString
    upper95: DecimalString
    baselineValue: DecimalString  # noqa: N815
    drivers: Drivers | None = None


class ResultOut(_Strict):
    ref: Ref
    status: Literal["OK", "ERROR"]
    error: str | None
    model: ModelInfo | None
    baseline: BaselineInfo | None
    points: list[PointOut]
    backtest: BacktestInfo | None = None
    outliers: list[Period] | None = None


class ForecastResponseV1(_Strict):
    schemaVersion: Literal["1"]  # noqa: N815
    requestId: str  # noqa: N815
    serviceVersion: str  # noqa: N815
    results: list[ResultOut]
    durationMs: int = Field(ge=0)  # noqa: N815


class ErrorBody(_Strict):
    code: Literal["INVALID_REQUEST", "UNAUTHORIZED", "PAYLOAD_TOO_LARGE", "BUSY", "DEADLINE_EXCEEDED"]
    detail: str


class ModelFamily(_Strict):
    name: str
    version: str


class ModelsResponse(_Strict):
    serviceVersion: str  # noqa: N815
    modelSet: str  # noqa: N815
    models: list[ModelFamily]
