# Tareas

> Requiere aplicados: `add-api-conventions`, `add-workspace-identity`, `add-audit-trail`, `add-manual-conversions`. Debe aplicarse antes de `add-basic-dashboard` (docs/03 §7). Decisión y fuentes: ADR-0025.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner el spec `fx/market-rate-providers` (umbrales: obsolescencia 60 min / 48 h, anomalía 5 %, intervalo 15 min) y las preguntas abiertas de design.md; verificar con `openspec validate add-market-rate-providers --strict`
- [ ] 1.2 Revisar TC-FX-PROVIDER-001..015 contra los scenarios (cifras: mediana 12.02, compra 12.12, venta 11.92, oficial 12.00, Binance 12.04/12.07 → 12.055; fechas fijas con `FixedClock`); verificar que el chequeo del catálogo los acepta y que todo requirement Must tiene ≥ 1 TC
- [ ] 1.3 Grabar los fixtures de contrato en `packages/fx/test/fixtures/providers/` con el texto exacto de las respuestas verificadas el 2026-10-02 (`paralelo-bo/rate.ok.json`, `rate.median-null.json`, `rate.18-decimals.json`, `rate.schema-changed.json`, `historical.sample.json`, `dolarapi-bo/dolares.ok.json`) más respuestas HTTP 429/503/timeout; verificar que ningún fixture contiene datos de usuario

## 2. DOMAIN (TDD, lógica financiera crítica)

- [ ] 2.1 VO `ProviderSample` y `RateAttribution`; `LosslessJsonReader` (texto → `Decimal`, rechazo de nulos/no positivos/> 18 decimales): escribir antes del código los tests de TC-FX-PROVIDER-003 y TC-FX-PROVIDER-004, incluido PBT (fast-check) de ida y vuelta texto → Decimal → texto sin pérdida
- [ ] 2.2 `ValuationRateSelector` + `StalenessPolicy` (principal → respaldo → última conocida obsoleta o manual más reciente → `FX_RATE_NOT_FOUND`): tests TDD de TC-FX-PROVIDER-007 y TC-FX-PROVIDER-008 escritos antes del código, más PBT: nunca devuelve una tasa con `asOf > t`, fuera de la ventana, reemplazada ni anómala pendiente
- [ ] 2.3 `AnomalyDetector` (variación a precisión 40, línea base = última aceptada): tests TDD de TC-FX-PROVIDER-010 (12.02 → 13.50 = +12.31 %, 12.02 → 12.10 = +0.67 %)
- [ ] 2.4 Regla de prevalencia manual en `RateResolver.resolveForConversion` (referencia explícita gana; providers nunca tocan filas `MANUAL`): tests TDD de TC-FX-PROVIDER-009

## 3. APPLICATION

- [ ] 3.1 `PollMarketRates` (una solicitud por provider y ciclo, fan-out por workspace con `SET LOCAL`, idempotencia por vigencia, anomalía, outbox `fx.RateRecorded.v1` solo si hubo inserción, fila en `fx.provider_run`): tests de aplicación con dobles del puerto para TC-FX-PROVIDER-001, TC-FX-PROVIDER-002 y TC-FX-PROVIDER-005
- [ ] 3.2 `BackfillHistoricalRates` (consumidor idempotente de `identity.WorkspaceCreated.v1` + siembra de preferencias `PARALLEL`) y `FillRateGaps`: tests de TC-FX-PROVIDER-006 (788 puntos, reimportación = 0 nuevas, relleno de 3 días)
- [ ] 3.3 `ReviewRateAnomaly` (EDITOR/OWNER, motivo, audit en la misma transacción, 409/422): tests de TC-FX-PROVIDER-010
- [ ] 3.4 `GetProviderStatus` (HEALTHY/DEGRADED/DOWN/DISABLED): tests de TC-FX-PROVIDER-015

## 4. INFRASTRUCTURE

- [ ] 4.1 Migraciones expand: columnas nuevas de `fx.exchange_rate`, índice único parcial de idempotencia por provider, `fx.rate_anomaly_review` (WS, append-only), `fx.provider_run` (instalación); grants y RLS; tests de integración con Testcontainers (UPDATE/DELETE denegados, idempotencia del índice, aislamiento entre dos workspaces)
- [ ] 4.2 `ProviderHttpClient` (token bucket, caché `max-age`, `Retry-After` persistido, timeout, allowlist de hosts, cabeceras fijas sin datos de usuario): tests de integración contra servidor HTTP local para TC-FX-PROVIDER-011 y TC-FX-PROVIDER-013
- [ ] 4.3 Adapters `ParaleloBoProvider` y `DolarApiBoProvider` (ACL + JSON Schema del adapter): **contract tests contra los fixtures grabados** (sin red) para TC-FX-PROVIDER-001..004; verificar que un cambio de schema produce `PROVIDER_SCHEMA_CHANGED` y ninguna tasa
- [ ] 4.4 Jobs pg-boss `fx.poll-market-rates`, `fx.backfill-historical-rates`, `fx.fill-rate-gaps` con `singletonKey` y configuración validada (`FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL` ≥ 60 s, `FX_STALE_AFTER_*`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED`); test de integración con el worker y `FixedClock` (TC-FX-PROVIDER-005, TC-FX-PROVIDER-014)
- [ ] 4.5 Regla ESLint + test de arquitectura: prohibido `JSON.parse`/`response.json()` en `@pf/fx` infrastructure/providers y prohibido que el cliente HTTP reciba contexto de workspace

## 5. API

- [ ] 5.1 `GET /fx-providers/status`, `POST /fx-rates/{fxRateId}/anomaly-review`, parámetros `source`/`provider` en `listFxRates` y campos aditivos de `FxRate`/`ResolvedRate` según design.md §Contratos; tests de API y de contrato (Redocly/Spectral sobre el OpenAPI consolidado) con TC-FX-PROVIDER-010, TC-FX-PROVIDER-012 y TC-FX-PROVIDER-015
- [ ] 5.2 Tests de autorización: VIEWER ve estado y tasas pero no revisa anomalías; aislamiento entre dos workspaces (la revisión de uno no afecta al otro)

## 6. UI

- [ ] 6.1 `RateSourceBadge` junto a toda tasa de provider ("Fuente: paralelo.bo" con enlace y CC BY 4.0; "Fuente: bo.dolarapi.com"), indicador de obsolescencia con antigüedad relativa (`es-BO`) y nivel de fallback; verificar con tests de componentes (TC-FX-PROVIDER-012)
- [ ] 6.2 Pantalla `/fx` → Providers: estado por provider y feed, carga histórica, bandeja de anomalías pendientes con confirmar/rechazar y motivo; textos en español vía i18n

## 7. TESTS automatizados y E2E

- [ ] 7.1 Agregar TC-FX-PROVIDER-003, -007, -008 y -009 a la Financial Regression Suite; verificar que corren en el gate de PR sin red
- [ ] 7.2 E2E Playwright con providers simulados por servidor local: principal OK (12.02 con atribución), principal caído (12.055 de respaldo), ambos caídos (12.02 obsoleta con antigüedad), anomalía 13.50 confirmada
- [ ] 7.3 Smoke **opcional en vivo, no bloqueante** (`pnpm fx:smoke-live`, nightly, `continue-on-error`): una solicitud a cada endpoint real, validación contra el JSON Schema del adapter y hash de `https://paralelo.bo/openapi.json`; su falla abre un aviso para revisar el adapter, nunca rompe el pipeline

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/08 (columnas nuevas, `fx.rate_anomaly_review`, `fx.provider_run` como excepción sin `workspace_id`), docs/10 (recursos `fx-providers` y códigos), docs/11 (`fx.RateRecorded.v1` aditivo, FX consumidor de `WorkspaceCreated`), docs/19 (variables `FX_*` en `.env.example`) y el runbook de "provider caído"; registrar la revisión de ToS por adapter (NFR-COMP-007) en ADR-0025 §Notas
- [ ] 8.2 Incorporar en docs/01 las FR nuevas FR-FX-013..017 y el cambio de fase de FR-FX-009/010 (lo hace el lead); actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict`; verificar 0 requirements Must sin cobertura
