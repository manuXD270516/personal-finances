# Tareas

> Requiere aplicados: `add-api-conventions`, `add-workspace-identity`, `add-audit-trail`, `add-manual-conversions`. Debe aplicarse antes de `add-basic-dashboard` (docs/03 §7). Decisión y fuentes: ADR-0025.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner el spec `fx/market-rate-providers` (umbrales: obsolescencia 60 min / 48 h, anomalía 5 %, intervalo 15 min) y las preguntas abiertas de design.md; verificar con `openspec validate add-market-rate-providers --strict`
  - Nota (2026-10-03): umbrales confirmados por el owner; decisiones aplicadas (design.md 29–32): compra/venta como `PARALLEL_BUY`/`PARALLEL_SELL`, `FX_STALE_AFTER_FALLBACK` (180 min), manual de otro tipo como último recurso con los criterios de docs/31 D34 (`FX_MANUAL_FALLBACK_MAX_AGE` 24 h, confirmado el 2026-10-04 en docs/31 D38; desvío ≤ 5 %) y salida de red del worker en modo B. Nuevos TC-FX-PROVIDER-016..019. `openspec validate --all --strict` pasa.
  - Nota (2026-10-04): el owner confirmó `FX_MANUAL_FALLBACK_MAX_AGE` = 24 h (docs/31 D38) y la convención de compra/venta desde su lado con ambos sentidos junto a la mediana (docs/31 D39). Sin cambios de código.
- [x] 1.2 Revisar TC-FX-PROVIDER-001..015 contra los scenarios (cifras: mediana 12.02, compra 12.12, venta 11.92, oficial 12.00, Binance 12.04/12.07 → 12.055; fechas fijas con `FixedClock`); verificar que el chequeo del catálogo los acepta y que todo requirement Must tiene ≥ 1 TC
  - Nota (2026-10-03): cifras verificadas contra los scenarios y los tests (12.02, 12.12/11.92, oficial 12, 12.04/12.07 → 12.055, 412 s, 600 s, 21600 s, 3142 s, +12.3128 %, +0.6656 %); `pnpm traceability:check` acepta los 15 TC y todo requirement Must tiene ≥ 1 TC. TC-012 y TC-014 quedan `ready` con automatización parcial (UI y dashboard pendientes).
- [x] 1.3 Grabar los fixtures de contrato en `packages/fx/test/fixtures/providers/` con el texto exacto de las respuestas verificadas el 2026-10-02 (`paralelo-bo/rate.ok.json`, `rate.median-null.json`, `rate.18-decimals.json`, `rate.schema-changed.json`, `historical.sample.json`, `dolarapi-bo/dolares.ok.json`) más respuestas HTTP 429/503/timeout; verificar que ningún fixture contiene datos de usuario
  - Nota (2026-10-03): fixtures en `packages/contexts/fx/test/fixtures/providers/` (la ruta real del paquete); texto exacto de TC-001/002 + variantes; además respuestas grabadas EN VIVO el 2026-10-03 (`rate.recorded-2026-10-03.json`, `dolares.recorded-2026-10-03.json`, base real de `historical.sample.json`; design.md decisión 15). 429/503/timeout/redirección los simula el servidor HTTP local de los tests. Sin datos de usuario (solo tasas públicas).

## 2. DOMAIN (TDD, lógica financiera crítica)

- [x] 2.1 VO `ProviderSample` y `RateAttribution`; `LosslessJsonReader` (texto → `Decimal`, rechazo de nulos/no positivos/> 18 decimales): escribir antes del código los tests de TC-FX-PROVIDER-003 y TC-FX-PROVIDER-004, incluido PBT (fast-check) de ida y vuelta texto → Decimal → texto sin pérdida
  - Nota (2026-10-03): `LosslessJsonReader` vive en `infrastructure/providers` (parser propio) y la validación decimal (`canonicalRateValue`) en el dominio; PBT de 1000 corridas.
- [x] 2.2 `ValuationRateSelector` + `StalenessPolicy` (principal → respaldo → última conocida obsoleta o manual más reciente → `FX_RATE_NOT_FOUND`): tests TDD de TC-FX-PROVIDER-007 y TC-FX-PROVIDER-008 escritos antes del código, más PBT: nunca devuelve una tasa con `asOf > t`, fuera de la ventana, reemplazada ni anómala pendiente
- [x] 2.3 `AnomalyDetector` (variación a precisión 40, línea base = última aceptada): tests TDD de TC-FX-PROVIDER-010 (12.02 → 13.50 = +12.31 %, 12.02 → 12.10 = +0.67 %)
- [x] 2.4 Regla de prevalencia manual en `RateResolver.resolveForConversion` (referencia explícita gana; providers nunca tocan filas `MANUAL`): tests TDD de TC-FX-PROVIDER-009
  - Nota (2026-10-03): cubierto con tests de aplicación (`market-rate-providers.test.ts`); la exclusión de anomalías aplica también a la referencia resuelta.

## 3. APPLICATION

- [x] 3.1 `PollMarketRates` (una solicitud por provider y ciclo, fan-out por workspace con `SET LOCAL`, idempotencia por vigencia, anomalía, outbox `fx.RateRecorded.v1` solo si hubo inserción, fila en `fx.provider_run`): tests de aplicación con dobles del puerto para TC-FX-PROVIDER-001, TC-FX-PROVIDER-002 y TC-FX-PROVIDER-005
- [x] 3.2 `BackfillHistoricalRates` (consumidor idempotente de `identity.WorkspaceCreated.v1` + siembra de preferencias `PARALLEL`) y `FillRateGaps`: tests de TC-FX-PROVIDER-006 (788 puntos, reimportación = 0 nuevas, relleno de 3 días)
  - Nota (2026-10-03): la siembra de preferencias y el encolado del backfill van en el consumidor `fx.market-rate-provisioning` (inbox) y también en `FillRateGaps` para workspaces previos (decisión 25).
- [x] 3.3 `ReviewRateAnomaly` (EDITOR/OWNER, motivo, audit en la misma transacción, 409/422): tests de TC-FX-PROVIDER-010
- [x] 3.4 `GetProviderStatus` (HEALTHY/DEGRADED/DOWN/DISABLED): tests de TC-FX-PROVIDER-015

## 4. INFRASTRUCTURE

- [x] 4.1 Migraciones expand: columnas nuevas de `fx.exchange_rate`, índice único parcial de idempotencia por provider, `fx.rate_anomaly_review` (WS, append-only), `fx.provider_run` (instalación); grants y RLS; tests de integración con Testcontainers (UPDATE/DELETE denegados, idempotencia del índice, aislamiento entre dos workspaces)
  - Nota (2026-10-03): migraciones `20261003230000_fx_market_rate_providers.sql` y `20261003230100_iam_workspace_directory_role.sql`; tests en `packages/contexts/fx/test/integration/providers.int.test.ts`.
- [x] 4.2 `ProviderHttpClient` (token bucket, caché `max-age`, `Retry-After` persistido, timeout, allowlist de hosts, cabeceras fijas sin datos de usuario): tests de integración contra servidor HTTP local para TC-FX-PROVIDER-011 y TC-FX-PROVIDER-013
  - Nota (2026-10-03): ventana deslizante de 60 s en lugar de token bucket y `node:http(s)` en lugar de fetch (decisión 19); `Retry-After` persistido vía `fx.provider_run` (decisión 20).
- [x] 4.3 Adapters `ParaleloBoProvider` y `DolarApiBoProvider` (ACL + JSON Schema del adapter): **contract tests contra los fixtures grabados** (sin red) para TC-FX-PROVIDER-001..004; verificar que un cambio de schema produce `PROVIDER_SCHEMA_CHANGED` y ninguna tasa
- [x] 4.4 Jobs pg-boss `fx.poll-market-rates`, `fx.backfill-historical-rates`, `fx.fill-rate-gaps` con `singletonKey` y configuración validada (`FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL` ≥ 60 s, `FX_STALE_AFTER_*`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED`); test de integración con el worker y `FixedClock` (TC-FX-PROVIDER-005, TC-FX-PROVIDER-014)
  - Nota (2026-10-03): sin `singletonKey` en el puerto `JobQueue` (decisión 22); test de worker completo con pg-boss real en `apps/api/test/events/fx-providers-worker.int.test.ts` y registro de colas/cron en `apps/api/src/worker/fx-jobs.test.ts`.
- [x] 4.5 Regla ESLint + test de arquitectura: prohibido `JSON.parse`/`response.json()` en `@pf/fx` infrastructure/providers y prohibido que el cliente HTTP reciba contexto de workspace
  - Nota (2026-10-03): regla `no-restricted-syntax` en eslint.config.js (verificada en `scripts/architecture`) + test de arquitectura `providers.architecture.test.ts`.

## 5. API

- [x] 5.1 `GET /fx-providers/status`, `POST /fx-rates/{fxRateId}/anomaly-review`, parámetros `source`/`provider` en `listFxRates` y campos aditivos de `FxRate`/`ResolvedRate` según design.md §Contratos; tests de API y de contrato (Redocly/Spectral sobre el OpenAPI consolidado) con TC-FX-PROVIDER-010, TC-FX-PROVIDER-012 y TC-FX-PROVIDER-015
  - Nota (2026-10-03): el contrato ya estaba consolidado (sin cambios en `contracts/`); `ReportSummary.meta.attributions` lo implementa add-basic-dashboard.
- [x] 5.2 Tests de autorización: VIEWER ve estado y tasas pero no revisa anomalías; aislamiento entre dos workspaces (la revisión de uno no afecta al otro)

## 6. UI

- [x] 6.1 `RateSourceBadge` junto a toda tasa de provider ("Fuente: paralelo.bo" con enlace y CC BY 4.0; "Fuente: bo.dolarapi.com"), indicador de obsolescencia con antigüedad relativa (`es-BO`) y nivel de fallback; verificar con tests de componentes (TC-FX-PROVIDER-012)
  - Nota (2026-10-03): pendiente (fuera del alcance de esta implementación).
  - Nota (2026-10-04): se reutiliza el `RateSourceBadge` del Home (`apps/web/src/ui/dashboard`), sin duplicarlo: la atribución pasa a `RateAttributionLink` (texto enlazado + licencia enlazada), que usan el Home, la pestaña Tasas de `/fx` y Proveedores; el badge suma el nivel ("respaldo", "última conocida") y el tipo pedido cuando difiere. Antigüedad relativa con `formatAge` (es-BO). Tests de componentes en `apps/web/src/ui/fx/providers.test.tsx` (TC-FX-PROVIDER-012, -008, -018).
- [x] 6.2 Pantalla `/fx` → Providers: estado por provider y feed, carga histórica, bandeja de anomalías pendientes con confirmar/rechazar y motivo; textos en español vía i18n
  - Nota (2026-10-03): pendiente (fuera del alcance de esta implementación).
  - Nota (2026-10-04): `/fx` pasa a pestañas Tasas | Proveedores (`?vista=proveedores`; `ProvidersPanel`): tasa de valoración vigente por par (USD/BOB y USDT/BOB `PARALLEL`, USD/BOB `OFFICIAL`) con su badge; tarjeta por provider (salud, último intento/éxito, fallas seguidas, último error con HTTP, próximo intento, `Retry-After`, feeds con rol, última tasa, antigüedad y obsolescencia, carga histórica); compra/venta `PARALLEL_BUY`/`PARALLEL_SELL` como "Compra"/"Venta" desde el lado del owner (D39); bandeja de anomalías (tasas `PROVIDER` de los últimos 7 días) con confirmar/rechazar y motivo de 3–500 caracteres (EDITOR/OWNER; VIEWER solo lectura) y revisadas recientemente. i18n es/en/pt. Tests de componentes (TC-FX-PROVIDER-010, -015, -016).

## 7. TESTS automatizados y E2E

- [x] 7.1 Agregar TC-FX-PROVIDER-003, -007, -008 y -009 a la Financial Regression Suite; verificar que corren en el gate de PR sin red
  - Nota (2026-10-03): TC-003/007/008/009 ya tenían `regression_suite: true` y son tests unitarios sin red que corren en el gate de PR (`pnpm turbo test`).
- [x] 7.2 E2E Playwright con providers simulados por servidor local: principal OK (12.02 con atribución), principal caído (12.055 de respaldo), ambos caídos (12.02 obsoleta con antigüedad), anomalía 13.50 confirmada
  - Nota (2026-10-03): pendiente (E2E con providers simulados).
  - Nota (2026-10-04): `tests/e2e/specs/fx-providers.spec.ts` + `tests/e2e/src/fx-sim.ts`: el harness sirve paralelo.bo y bo.dolarapi.com desde un servidor HTTP local (formato de los fixtures grabados) y el worker del stack E2E los alcanza por `FX_PROVIDER_PARALELO_BO_URL`/`FX_PROVIDER_DOLARAPI_BO_URL=http://host.docker.internal:<prefijo>9090` (variables nuevas y opcionales, solo del worker, rechazadas con `PFOS_ENV=staging|production`; `extra_hosts: host-gateway` en el worker para Linux). El cron corre cada 24 h y la prueba dispara cada ciclo encolando `fx.poll-market-rates` (pg-boss). Cuatro escenarios, cada uno en un workspace creado en el momento justo (la consulta reparte a todos): 12.02 principal con atribución CC BY 4.0, compra/venta y carga histórica; 12.055 de respaldo con la falla HTTP 503 del principal; 12.02 última conocida obsoleta "hace N d"; 13.50 anómala (+12,31 %) que el VIEWER ve sin acciones y el EDITOR confirma con motivo en W1. Verifica además que las solicitudes al simulado no llevan query, cookies ni credenciales.
- [x] 7.3 Smoke **opcional en vivo, no bloqueante** (`pnpm fx:smoke-live`, nightly, `continue-on-error`): una solicitud a cada endpoint real, validación contra el JSON Schema del adapter y hash de `https://paralelo.bo/openapi.json`; su falla abre un aviso para revisar el adapter, nunca rompe el pipeline
  > Verificado 2026-10-04 (pendiente, CI): no existe el script `fx:smoke-live` ni workflow nightly.
  > Hecho 2026-10-04 (ci/nightly-perf): `pnpm fx:smoke-live` (`packages/contexts/fx/test/live/smoke-live.ts`) usa el `ProviderHttpClient` y los adapters reales, valida cada respuesta contra `PARALELO_RATE_CONTRACT`/`PARALELO_HISTORY_CONTRACT`/`DOLARAPI_DOLARES_CONTRACT` (validador en `test/live/json-contract.ts`, probado con los fixtures grabados) y compara el SHA-256 de `https://paralelo.bo/openapi.json` con `test/fixtures/providers/paralelo-bo/openapi.sha256`. Job `fx-smoke-live` del nightly con `continue-on-error: true` y `issues: write` (abre o comenta el issue de revisión). Corrida local: `/api/v1/rate`, `/api/v1/historical.json` y `/v1/dolares` OK contra el contrato; **`/openapi.json` responde 404** (hoy responde `/api/v1/openapi.json`), así que aún no hay línea base del hash y el smoke marca la falla: decisión del owner sobre la URL canónica y luego `pnpm fx:smoke-live -- --update-baseline`.
  - Nota (2026-10-03): pendiente (smoke en vivo no bloqueante `pnpm fx:smoke-live`); los contratos del adapter ya están como constantes reutilizables.

- [x] 7.4 Decisiones del owner 2026-10-03 (TDD + PBT): TC-FX-PROVIDER-016 (compra/venta, contract + aplicación + PostgreSQL), -017 (umbral del respaldo), -018 (manual de otro tipo, PBT 500 corridas), -019 (`test:stack`: worker en redes no internas y `FX_*` del `.env`)

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/08 (columnas nuevas, `fx.rate_anomaly_review`, `fx.provider_run` como excepción sin `workspace_id`), docs/10 (recursos `fx-providers` y códigos), docs/11 (`fx.RateRecorded.v1` aditivo, FX consumidor de `WorkspaceCreated`), docs/19 (variables `FX_*` en `.env.example`) y el runbook de "provider caído"; registrar la revisión de ToS por adapter (NFR-COMP-007) en ADR-0025 §Notas
  - Nota (2026-10-03): hecho: docs/08, docs/10, docs/11, docs/19 (+ `docs/config-reference.md` regenerado, `.env.example`), runbook `docs/runbooks/fx-provider-caido.md` y revisión de ToS por adapter en ADR-0025 §Notas. Queda abierto solo por la aprobación del lead.
- [ ] 8.2 Incorporar en docs/01 las FR nuevas FR-FX-013..017 y el cambio de fase de FR-FX-009/010 (lo hace el lead); actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict`; verificar 0 requirements Must sin cobertura
  - Nota (2026-10-03): parcial: estados de automatización de los TC actualizados, matriz de trazabilidad regenerada y `openspec validate --all --strict` en verde; FR-FX-013..017 en docs/01 los incorpora el lead.
