"""Aplicación FastAPI del servicio: un proceso, sin estado, una petición de pronóstico a la vez."""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import SERVICE_VERSION
from .config import Settings, load_settings
from .forecast import MODEL_NAME, MODEL_VERSION, forecast_series
from .schemas import (
    ErrorBody,
    ForecastRequestV1,
    ForecastResponseV1,
    ModelFamily,
    ModelsResponse,
)

log = logging.getLogger("finance_ml")

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorBody, "description": desc}
    for code, desc in {
        400: "Cuerpo inválido.",
        401: "Sin credencial de servicio o inválida.",
        413: "Cuerpo demasiado grande.",
        503: "Servicio ocupado; reintentar.",
        504: "Corte interno del cómputo.",
    }.items()
}


class JsonFormatter(logging.Formatter):
    """Registros JSON con campos acotados: nunca montos ni cuerpos de petición."""

    ALLOWED = ("event", "series", "points", "durationMs", "version", "outcome", "status")

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {"level": record.levelname, "msg": record.getMessage()}
        for key in self.ALLOWED:
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        return json.dumps(payload, separators=(",", ":"))


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger("finance_ml")
    root.handlers = [handler]
    root.setLevel(level)
    root.propagate = False


def _problem(status: int, code: str, detail: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail}, headers=headers)


class BodyLimitMiddleware:
    """Rechaza con 413 los cuerpos que exceden el límite (por Content-Length o contando los bytes leídos)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        too_large = _problem(413, "PAYLOAD_TOO_LARGE", "request body exceeds the limit")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await too_large(scope, receive, send)
            return
        seen = 0
        exceeded = False

        async def limited() -> Message:
            nonlocal seen, exceeded
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    exceeded = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        started = False

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if exceeded and not started:
                started = True
                await too_large(scope, receive, send)
                return
            if exceeded:
                return
            await send(message)

        await self.app(scope, limited, guarded_send)


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or load_settings()
    configure_logging(cfg.log_level)
    app = FastAPI(
        title="PFOS finance-ml",
        version="1.0.0",
        description="Servicio interno de pronósticos. No es la API pública.",
        docs_url=None,
        redoc_url=None,
    )
    app.add_middleware(BodyLimitMiddleware, max_bytes=cfg.max_body_bytes)
    busy = asyncio.Semaphore(1)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Solo la ubicación de los errores: nunca el valor recibido (puede traer montos).
        where = "; ".join(".".join(str(p) for p in e["loc"][1:]) or "body" for e in exc.errors()[:5])
        return _problem(400, "INVALID_REQUEST", f"invalid fields: {where}")

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _problem(exc.status_code, "INVALID_REQUEST", "not found" if exc.status_code == 404 else "error")

    def authorized(request: Request) -> bool:
        if cfg.token is None:
            return False
        header = request.headers.get("authorization", "")
        scheme, _, presented = header.partition(" ")
        if scheme.lower() != "bearer" or not presented:
            return False
        return hmac.compare_digest(presented.strip().encode(), cfg.token)

    @app.middleware("http")
    async def auth(request: Request, call_next: Callable[[Request], Awaitable[Any]]) -> Any:
        if request.url.path.startswith("/v1/") and not authorized(request):
            return _problem(401, "UNAUTHORIZED", "missing or invalid service credential")
        return await call_next(request)

    @app.get("/health/live", operation_id="live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", operation_id="ready", tags=["health"], responses={503: {"model": ErrorBody}})
    async def ready() -> Any:
        if cfg.token is None:
            return _problem(503, "UNAUTHORIZED", "service credential not configured")
        return {"status": "ok"}

    @app.get(
        "/v1/models",
        operation_id="listModels",
        response_model=ModelsResponse,
        responses={401: ERROR_RESPONSES[401]},
        tags=["forecasts"],
    )
    async def models() -> ModelsResponse:
        return ModelsResponse(
            serviceVersion=SERVICE_VERSION,
            modelSet="baseline-v1",
            models=[
                ModelFamily(name=MODEL_NAME, version=MODEL_VERSION),
                ModelFamily(name="naive", version=MODEL_VERSION),
                ModelFamily(name="seasonal_naive", version=MODEL_VERSION),
            ],
        )

    def compute(body: ForecastRequestV1) -> ForecastResponseV1:
        started = time.perf_counter()
        results = [forecast_series(s) for s in body.series]
        elapsed = int((time.perf_counter() - started) * 1000)
        return ForecastResponseV1(
            schemaVersion="1",
            requestId=body.requestId,
            serviceVersion=SERVICE_VERSION,
            results=results,
            durationMs=elapsed,
        )

    @app.post(
        "/v1/forecasts",
        operation_id="createForecast",
        response_model=ForecastResponseV1,
        responses=ERROR_RESPONSES,
        tags=["forecasts"],
    )
    async def create_forecast(body: ForecastRequestV1) -> Any:
        if len(body.series) > cfg.max_series:
            return _problem(400, "INVALID_REQUEST", "too many series")
        if any(len(s.points) > cfg.max_periods for s in body.series):
            return _problem(400, "INVALID_REQUEST", "too many periods")
        if busy.locked():
            return _problem(503, "BUSY", "another forecast is running", {"Retry-After": "5"})
        async with busy:
            started = time.perf_counter()
            try:
                result = await asyncio.wait_for(asyncio.to_thread(compute, body), timeout=cfg.compute_deadline_s)
            except TimeoutError:
                log.warning("forecast deadline exceeded", extra={"event": "deadline", "outcome": "timeout"})
                return _problem(504, "DEADLINE_EXCEEDED", "compute deadline exceeded")
        log.info(
            "forecast completed",
            extra={
                "event": "forecast",
                "series": len(body.series),
                "points": sum(len(r.points) for r in result.results),
                "durationMs": int((time.perf_counter() - started) * 1000),
                "version": SERVICE_VERSION,
                "outcome": "ok",
            },
        )
        return result

    _instrument(app)
    return app


def _instrument(app: FastAPI) -> None:
    """OpenTelemetry de FastAPI (propaga `traceparent`); sin exportador configurado no envía nada."""
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app, excluded_urls="health/.*")
    except Exception:  # noqa: BLE001 - la telemetría nunca debe impedir arrancar
        log.warning("telemetry unavailable", extra={"event": "telemetry"})
