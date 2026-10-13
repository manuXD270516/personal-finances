# Tareas

> Depende de Phase 1 (conversiones, `fx/conversion-pricing`) y Phase 2 (periodos financieros). Independiente de los changes 37, 38 y 39 (el Could usa `PARALLEL_BUY`/`PARALLEL_SELL` de Phase 1). **El grupo 2 (conexiones) va antes que el consumidor del grupo 5 (D249).** Confirmar las preguntas 2 y 3 de design.md antes del grupo 5; no bloquean la spec. No toca `debt/loans` ni `debt/amortization` (D219).
>
> Implementación 2026-10-13 (sin Docker en la sesión): los gates sin contenedores corrieron en verde (format, typecheck, lint, tests unitarios, build, arch, trazabilidad, spec, config-docs, Redocly y Spectral). Los tests de integración, de API, e2e, el stack y `contract:breaking` quedan escritos y los valida CI. Un test de `apps/web` (`providers.test.tsx`, formato de hora `a. m.`) falla igual en `main` por la versión de ICU del entorno.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas de `fx/conversion-pricing` y `fx/market-rates`; `openspec validate add-conversion-cost-analysis --strict` — `pnpm spec:validate` en verde (2026-10-13)
- [x] 1.2 Revisar TC-FX-COST-001..010, TC-FX-USERCONV-001..004 y TC-PLATFORM-EVENTS-019 contra los scenarios (cifras a mano: 100 × 12.00 + 300 × 12.00 = 4800.00 BOB; 10.00 + 18.00 = 28.00 BOB; 28.00 / 4800.00 = 0.5833 %; 0.20 × 50 = 10.00 BOB; (11.92 − 11.90) / 11.92 = 0.1678 %); pasar a `ready` y `requirement_status: confirmed` — cifras verificadas en los tests; los 15 TC quedan `requirement_status: confirmed` y `automated` (nota: TC-FX-COST-005 decía 422 y el catálogo de errores mapea `VALIDATION_FAILED` a 400; se corrigió el TC)

## 2. PLATAFORMA: CONEXIONES (antes del consumidor, D249)

- [x] 2.1 `max_connections` de 60 a 70 en `deploy/compose/compose.prod.yaml` y `DATABASE_POOL_MAX` del worker de 33 a 34 en `deploy/host/etc-pfos/pfos.env.example`, con el comentario de cálculo actualizado (28 consumidores + 4 reservadas + 2 de margen; 34 + 22 = 56 sobre 70); revisar la memoria de Postgres frente a su límite — hecho; el margen de memoria frente al límite de 384 MiB es estrecho si las 56 conexiones se abren a la vez (anotado en el compose: vigilar tras el despliegue)
- [x] 2.2 Test de arranque del worker con el consumidor nuevo y la plantilla del host (TC-PLATFORM-EVENTS-019); TC-PLATFORM-EVENTS-018 en verde — unitario en `packages/platform/src/events/consumers.test.ts` (verde) e integración en `event-throughput.int.test.ts` (arranque real con la plantilla; lo valida CI)

## 3. DOMAIN (TDD)

- [x] 3.1 `ConversionCostAggregator` test-first: agrupación por periodo, canal y par, ponderación, "Sin canal", exclusiones con motivo (TC-FX-COST-001, TC-FX-COST-002, TC-FX-COST-003; PBT con timeout explícito: Σ spread / Σ convertido = promedio ponderado; excluir conversiones no altera los demás grupos)
- [x] 3.2 Valoración en moneda de reporte de pares que no la incluyen y exclusión `NO_REPORTING_RATE` (TC-FX-COST-007)
- [x] 3.3 Spread alternativo contra `PARALLEL_BUY`/`PARALLEL_SELL` (Could; TC-FX-COST-008) — implementado (la recomendación (a) de la pregunta 1)

## 4. APPLICATION

- [x] 4.1 `ConversionDetailQuery.listForCostAnalysis` en `@pf/transactions/contracts` (revisión vigente, sin anuladas ni pendientes) (TC-FX-COST-010) — con la opción aditiva `includeVoided` para la carga inicial de FX
- [x] 4.2 `GetConversionCostAnalysis` con periodo financiero o mes calendario en la zona del workspace y una resolución de tasas fusionada (TC-FX-COST-004)
- [x] 4.3 `RateResolver` excluye `USER_CONVERSION` en valoración, referencia, cruzadas y fallback manual (TC-FX-USERCONV-002, PBT) — en la consulta del repositorio y como segunda barrera en `isUsableCandidate`
- [x] 4.4 `RecordUserConversionObservation` (registro, reemplazo por revisión, retiro por anulación) y `BackfillUserConversionObservations` (TC-FX-USERCONV-001, TC-FX-USERCONV-003, TC-FX-USERCONV-004)

## 5. INFRASTRUCTURE

- [x] 5.1 Migraciones expand-only: columnas e índice único parcial en `fx.exchange_rate`, `fx.rate_withdrawal` con RLS forzada y `platform.workspace_scoped_table`, sección de portabilidad; timestamps posteriores a la última de `main` — `20261015100000_fx_user_conversion_observations.sql` (también reemplaza el trigger de consistencia del reemplazo para observaciones de la misma conversión y publica los esquemas de export `exchange-rates` y `rate-withdrawals`)
- [x] 5.2 Consumidor `fx.user-conversion-observations` (inbox, concurrencia 1) para `ConversionRecorded.v1`, `ConversionRevised.v1` y `TransactionVoided.v1`; consultas secuenciales en la unidad de trabajo — más el job `fx.backfill-user-conversion-observations` (carga inicial idempotente al arrancar)
- [x] 5.3 Tests de integración: observaciones idempotentes, revisión y anulación (TC-FX-USERCONV-001, TC-FX-USERCONV-003), análisis contra PostgreSQL con aislamiento (TC-FX-COST-005, TC-FX-COST-010); `pnpm test:integration` dos veces en verde — tests escritos en `apps/api/test/api/conversion-costs.api.test.ts`; no corren sin Docker: los valida CI (las dos corridas consecutivas quedan pendientes de CI)

## 6. API

- [x] 6.1 OpenAPI: `getConversionCostAnalysis`, `exportConversionCostAnalysis` (`x-rate-limit: costly`), `ConversionCostAnalysis`, `FxRate.conversionRef` y `FxRate.withdrawn`; descripciones de consumidores en los schemas de eventos de TRANSACTIONS; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas — Redocly y Spectral sin errores; el cambio es solo aditivo (rutas y esquemas nuevos y propiedades opcionales en la respuesta `FxRate`); `contract:breaking` no corrió sin Docker
- [x] 6.2 Controllers y tests de API: TC-FX-COST-005 (VIEWER, aislamiento, solo lectura), TC-FX-COST-006 (CSV con neutralización y cuota costosa) — controllers en `reporting-http.ts`; la neutralización del CSV se prueba en la capa de aplicación (verde) y la ruta, el aislamiento y la cuota en el test de API (CI)

## 7. UI

- [x] 7.1 Vista "Costo de conversiones" (Reportes): selector de rango y agrupación, tabla por periodo, canal y par con excluidas, totales, exportación CSV; filtro por origen en el historial de tasas con las observaciones marcadas; i18n es/en/pt; axe y móvil (TC-FX-COST-009) — ruta `/fx/costos` (no existe una sección "Reportes" en la navegación: se enlaza desde Tasas de cambio); el Home no cambia

## 8. TESTS AUTOMATIZADOS y E2E

- [x] 8.1 E2E: registrar dos ventas por "Binance P2P" y una compra sin contraparte, ver el análisis con las cifras de los scenarios y exportar el CSV (TC-FX-COST-009); con `PF_E2E_PROJECT` — `tests/e2e/specs/fx-conversion-costs.spec.ts` (más la ruta en `a11y.spec.ts`); no corrió sin Docker
- [x] 8.2 Rendimiento: análisis de 12 meses con el seed `large` p95 ≤ 800 ms (NFR-PERF-006), nightly — medición agregada a `apps/api/test/perf/nightly.perf.ts` (el umbral estricto lo evalúa el nightly, no los tests unitarios)
- [x] 8.3 Regresión: TC-FX-HISTORICAL-001/002, TC-FX-PRICING-\*, TC-REPORTING-DASHBOARD-\*, TC-REPORTING-NETWORTH-\*, TC-PLATFORM-EVENTS-018 — suites unitarias de FX, REPORTING y plataforma en verde; las de integración las valida CI

## 9. DOCS

- [x] 9.1 docs/01 FR-FX-011 (canal, ponderación, exclusiones); docs/10 (endpoints); docs/11 (FX consume los eventos de conversiones); docs/14 (reporte de costo de conversiones); docs/19 y docs/38 §4 (presupuesto de conexiones nuevo, lo consolida la sesión principal); cierre de D26 en docs/31 si corresponde — hechos docs/01, 08, 10, 11, 14 y 31 (D26); docs/19 no menciona el presupuesto de conexiones y docs/38 §4 lo actualiza la sesión principal
- [x] 9.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate add-conversion-cost-analysis --strict` — en verde
