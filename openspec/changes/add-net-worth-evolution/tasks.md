# Tareas

> Requiere aplicados: `add-basic-dashboard`, `add-ledger-core`, `add-market-rate-providers`, `add-accounts-management` y, en el orden consolidado (docs/03 §7), `add-financial-periods` (puntos = periodos financieros) y `add-month-closing` (`ClosingSnapshotQuery.listCurrent`).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner los requirements añadidos a `reporting/net-worth` y las preguntas abiertas 1–3 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-net-worth-evolution --strict` _(2026-10-09: preguntas 1–3 resueltas por el owner en docs/33 — D59 (etiqueta del periodo = mes de inicio), D103 (`includeInNetWorth`: valor vigente para toda la serie con aviso en la UI; los periodos cerrados usan el valor congelado en su snapshot) y D104 (tarjeta compacta en el Home con 6 periodos y enlace a la vista completa de 12); `openspec validate add-net-worth-evolution --strict` en verde.)_
- [x] 1.2 Revisar TC-REPORTING-NETWORTH-006..012 (cifras: 2000.00 + 100.000000 × 10.00 − 300.00 = 2700.00; 2500.00 + 1050.00 = 3550.00; 2400.00 + 120.000000 × 11.00 − 150.00 = 3570.00); pasar a `ready` al aprobar _(2026-10-09: cifras verificadas a mano y automatizadas; TC-REPORTING-NETWORTH-006..012 pasan a `automated`.)_

## 2. DOMAIN (TDD)

- [x] 2.1 `NetWorthSeriesBuilder` puro, test-first: puntos por periodo financiero (incluido día de inicio 25 y periodo de transición), completitud, variación y comparabilidad, parcialidad del mes en curso, fuente `SNAPSHOT`/`COMPUTED` (TC-REPORTING-NETWORTH-006, -008, -009, -011) _(2026-10-09: `NetWorthSeriesBuilder` en `packages/contexts/reporting/src/domain/net-worth-series.ts` con tests test-first en `net-worth-series.test.ts`, incluido día de inicio 25.)_
- [x] 2.2 PBT: el punto del mes en curso a hoy coincide con el patrimonio actual de Phase 1 para el mismo conjunto de saldos y tasas (INV-031) _(2026-10-09: propiedad en `net-worth.properties.test.ts`.)_

## 3. APPLICATION

- [x] 3.1 `GetNetWorthHistory` con saldos as-of en lote, tasas resueltas por fecha con `windowDays` del setting (D53) y snapshots de cierre opcionales (TC-REPORTING-NETWORTH-007, -009, -010) _(2026-10-09: `GetNetWorthHistory` en `net-worth-history.queries.ts`; PLANNING no puede importarse desde REPORTING (ya depende de él), así que `PeriodQuery`/`ClosingSnapshotQuery` entran por puertos estructurales que la composición enlaza.)_
- [x] 3.2 Validación de rango y moneda de reporte (TC-REPORTING-NETWORTH-012) _(2026-10-09: rango en `NetWorthSeriesBuilder.resolveRange`; moneda no habilitada en la query.)_

## 4. INFRASTRUCTURE

- [x] 4.1 `LedgerQueryPort.getAccountBalancesAsOf(accountIds, dates[])` con `balance_snapshot`; benchmark con dataset `large` (p95 ≤ 800 ms, 24 meses) _(2026-10-09: `AccountBalanceHistoryQuery.getAccountBalancesAtDates` en `@pf/ledger/contracts` (una transacción y una lectura de frescura para todas las fechas, reutilizando la consulta con `balance_snapshot`); caso `NFR-PERF-006` en el benchmark nightly (24 meses, Large Seed): p95 263,74 ms local con 24 puntos, límite 800 ms.)_

## 5. API

- [x] 5.1 `getNetWorthHistory` en el contrato (`x-required-role: VIEWER`, ETag/304); tests de API por TC _(2026-10-09: `getNetWorthHistory` consolidado en `contracts/openapi/finance-api.v1.yaml` (Spectral 0 errores, `contract:breaking` sin rupturas); tests en `apps/api/test/api/net-worth-history.api.test.ts`.)_

## 6. UI

- [x] 6.1 Gráfico "Evolución del patrimonio" (tarjeta en el Home y vista completa) con puntos incompletos, cerrados y parcial, tooltip con tasas y atribución; i18n es/en/pt _(2026-10-09: `apps/web/src/ui/networth/`, ruta `/patrimonio`, namespace `NetWorthEvolution` es/en/pt; gráfico SVG con título y descripción, tabla de datos equivalente y estados sin depender del color.)_

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar TC-REPORTING-NETWORTH-006..012 con el TC-ID en el nombre; actualizar front matter _(2026-10-09: ver `automated_tests` de cada TC.)_
- [x] 7.2 E2E: la serie de tres meses del dataset de prueba se muestra con sus valores _(2026-10-09: `tests/e2e/specs/net-worth-evolution.spec.ts` (con axe) y `/patrimonio` en `a11y.spec.ts`.)_

## 8. DOCUMENTATION

- [x] 8.1 Actualizar docs/14 (§8 reporte 8 parcial en Phase 2, §11 endpoint), docs/10 §13, docs/01 FR-REPORTING-006, el `Purpose` de `reporting/net-worth` al archivar y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check` _(2026-10-09: docs/14 §8, §9.1 y §10, docs/10 §3 y §13.2, docs/01 FR-REPORTING-006 actualizados; el `Purpose` de `reporting/net-worth` se actualiza al archivar; trazabilidad y spec validadas.)_
