# finance-ml

Servicio interno de pronósticos de PFOS (openspec `add-ml-forecasting-service`, ADR-0033). Un proceso, sin estado, sin acceso a
la base de datos ni al almacenamiento de objetos y sin salida a Internet. Solo lo llama el worker (`@pf/forecasting`) por la red
interna `ml-internal`, con una credencial de servicio de archivo.

- `POST /v1/forecasts`: petición `ForecastRequestV1`, respuesta `ForecastResponseV1` (`contracts/ml/`). Una petición a la vez
  (`503` con `Retry-After`), cuerpo ≤ 2 MiB, ≤ 400 series, ≤ 120 periodos, corte de cómputo a 240 s (`504`).
- `GET /health/live`, `GET /health/ready` (sin autenticación) y `GET /v1/models` (autenticado).
- Modelos de este change: `baseline-v1` (último periodo, mismo periodo del año anterior y promedio móvil de 6) con intervalos
  empíricos del 80 % y 95 %, cuantizados con `Decimal` `ROUND_HALF_EVEN` a la escala de la moneda; sin aleatoriedad.
- Registros JSON solo con tamaños, duración y versión: nunca montos.

## Desarrollo

```sh
cd services/ml-forecasting
uv sync                              # dependencias del lockfile (solo versiones con 2 semanas o más: `exclude-newer`)
uv run ruff check . && uv run ruff format --check .
uv run mypy --strict .
uv run pytest                        # incluye hypothesis, el contrato y los ejemplos compartidos
uv run python -m scripts.export_openapi   # regenera contracts/openapi/ml-forecasting.v1.yaml (el job `ml` compara)
```

Los tests citan el TC-id entre corchetes en el docstring (`"""[TC-FORECAST-SERVICE-034] …"""`); `pnpm traceability:check` los
escanea. Variables: `ML_SERVICE_TOKEN_FILE`, `ML_MAX_BODY_BYTES`, `ML_MAX_SERIES`, `ML_MAX_PERIODS`, `ML_COMPUTE_DEADLINE_S`,
`ML_LOG_LEVEL`. Imagen: `docker/finance-ml.Dockerfile`; perfil `ml` de `deploy/compose/compose.yaml`.
