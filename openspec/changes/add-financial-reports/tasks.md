# Tareas

> Depende de Phases 1–6 archivadas (ledger, transacciones, periodos, presupuestos, conciliación, FX). Va **antes** que `add-financial-reports-extended`. Independiente de `add-cash-flow-forecast`, `add-historical-budgets` y `add-rule-suggestions` (en paralelo): coordinar solo `apps/api/test/perf/perf-report.ts` (`PERF_THRESHOLDS`). La pregunta 1 de design.md (read models) **bloquea el grupo 5**; las demás no bloquean. Sin consumidores nuevos ni cambios del presupuesto de conexiones. Sin Docker, `test:integration`, `test:e2e` y el nightly los valida CI.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `reporting/financial-reports`, `reporting/net-worth` y `reporting/dashboard`; `pnpm exec openspec validate add-financial-reports --strict`
- [ ] 1.2 Revisar TC-REPORTING-REPORTS-001..038 contra los scenarios con las cifras a mano (12000.00 − 3800.00 = 8200.00 BOB y 68.3 %; 800.00 / 3000.00 = 26.67 %; (3000.00 + 3300.00 + 3000.00) / 3 = 3100.00 BOB; flujo de caja 10000.00 + 8700.00 − 500.00 − 1000.00 = 17200.00 BOB; patrimonio 23000.00 → 31750.00 BOB = 8200.00 + 50.00 + 500.00); pasar a `ready` y `requirement_status: confirmed` tras las respuestas del owner

## 2. DOMAIN (TDD)

- [ ] 2.1 `ReportPeriodCalendar` test-first: periodos financieros y meses calendario por fecha de negocio en la zona del workspace, semanas ISO, tope de 24 periodos y 106 semanas, periodo parcial (TC-REPORTING-REPORTS-003)
- [ ] 2.2 `ReportComparator` test-first: MoM, YoY (incluido periodo financiero que empieza el día 25), rango personalizado con normalización por día, promedio móvil con historial insuficiente, variación con "nuevo" y "a la fecha" sobre `PeriodComparator` (TC-REPORTING-REPORTS-010, TC-REPORTING-REPORTS-011, TC-REPORTING-REPORTS-012, TC-REPORTING-REPORTS-013)
- [ ] 2.3 `ReportConversionPolicy` test-first sobre `FlowValuation`: tasa de la fecha, fecha de corte, saldos a la fecha de valoración, moneda de reporte, montos sin tasa en `unconverted` (nunca 1:1), redondeo solo al presentar (TC-REPORTING-REPORTS-014, TC-REPORTING-REPORTS-015, TC-REPORTING-REPORTS-016, TC-REPORTING-REPORTS-017)
- [ ] 2.4 `IncomeExpenseReport` y `CategoryTreeReport` test-first: reglas de flujos, tasa de ahorro sin definir, árbol grupo → categoría → subcategoría, top N con "Otras categorías", neto negativo, archivadas (TC-REPORTING-REPORTS-004, TC-REPORTING-REPORTS-005, TC-REPORTING-REPORTS-006)
- [ ] 2.5 `LiquidityFlowReport` test-first: clasificación por contrapartida, transferencias internas, cuota de préstamo, conversión entre líquidas, línea de revalorización del consolidado; PBT: inicial + componentes = final por moneda con timeout explícito (TC-REPORTING-REPORTS-008)
- [ ] 2.6 `BalanceStepSeries` test-first: saldo diario en escalón y marcas de conciliación (TC-REPORTING-REPORTS-009)
- [ ] 2.7 `NetWorthDecomposer` test-first: componentes, revalorización por moneda y por tipo, otros movimientos, incompleta sin tasa, serie diaria; PBT: ΔNW = Σ componentes a precisión 40 para tasas aleatorias > 0 (TC-REPORTING-REPORTS-033, TC-REPORTING-REPORTS-034, TC-REPORTING-REPORTS-035, TC-REPORTING-REPORTS-036)
- [ ] 2.8 `ReportReconciler` y PBT de reconciliación sobre ledgers aleatorios (ingresos, gastos, reembolsos, transferencias, conversiones con comisión, cuotas, pagos de tarjeta), con timeout explícito (TC-REPORTING-REPORTS-027)
- [ ] 2.9 Catálogo estático de los 16 reportes con estados `AVAILABLE`/`PARTIAL`/`PLANNED` (TC-REPORTING-REPORTS-001)

## 3. APPLICATION

- [ ] 3.1 TRANSACTIONS: filtros (`accountIds`, `counterpartyIds`, `tagIds`, `currencies`) y `groupBy` opcionales en `summarizeNominalFlows`, sin cambiar la agrupación por omisión (TC-REPORTING-REPORTS-002; regresión TC-REPORTING-DASHBOARD-\* y de presupuestos)
- [ ] 3.2 TRANSACTIONS: `NominalPortionQuery.listPortions` con keyset y totales de la celda (TC-REPORTING-REPORTS-018, TC-REPORTING-REPORTS-019)
- [ ] 3.3 LEDGER: `AccountSetFlowQuery.summarize` y `.listMovements` (TC-REPORTING-REPORTS-008, TC-REPORTING-REPORTS-020)
- [ ] 3.4 REPORTING: queries de los cinco reportes y del patrimonio en una unidad de trabajo, una resolución de tasas por petición, comparaciones fusionadas, llamadas secuenciales a PLANNING (TC-REPORTING-REPORTS-005, TC-REPORTING-REPORTS-006, TC-REPORTING-REPORTS-007, TC-REPORTING-REPORTS-008, TC-REPORTING-REPORTS-009, TC-REPORTING-REPORTS-033)
- [ ] 3.5 REPORTING: `GetReportDrillDown` con los cuatro tipos de fila y la identidad Σ filas = celda (TC-REPORTING-REPORTS-018, TC-REPORTING-REPORTS-019, TC-REPORTING-REPORTS-020, TC-REPORTING-REPORTS-037)
- [ ] 3.6 Exportadores CSV con streaming, conteo previo y tope de 50 000 filas; auditoría `reporting.report.exported` (Should, según pregunta 5) (TC-REPORTING-REPORTS-021, TC-REPORTING-REPORTS-022, TC-REPORTING-REPORTS-023)
- [ ] 3.7 Métrica `reporting_report_duration_seconds{report}` (TC-REPORTING-REPORTS-032)

## 4. INFRASTRUCTURE

- [ ] 4.1 Adapters PG de `listPortions` y `AccountSetFlowQuery` sin consultas en paralelo sobre el mismo cliente; tests de integración contra PostgreSQL con RLS y aislamiento (TC-REPORTING-REPORTS-025)
- [ ] 4.2 Adapters en la composición: `BudgetVsActualPort`, `FinancialPeriodsPort`, `ReconciliationMarksPort`, `ReportAuditPort` (REPORTING no importa `@pf/planning`)
- [ ] 4.3 Reconciliación de integración con el dataset Demo v2 (TC-REPORTING-REPORTS-028); `pnpm test:integration` dos veces seguidas en verde

## 5. RENDIMIENTO E ÍNDICES (bloqueado por la pregunta 1)

- [ ] 5.1 `EXPLAIN (ANALYZE, BUFFERS)` de las consultas de 12 meses y del drill-down sobre el Large Seed; si el keyset no usa índice, migración expand-only con `CREATE INDEX CONCURRENTLY` en archivo propio, timestamp posterior a la última de `main`
- [ ] 5.2 Filas `report-*` en `apps/api/test/perf/nightly.perf.ts` con el rango fijo 2025-10-01 → 2026-09-30, 12 presupuestos de 30 líneas creados por la prueba, `drillDownLimitMs: 300` en `PERF_THRESHOLDS['NFR-PERF-006']` (coordinar con la entrada NFR-PERF-010 de `add-cash-flow-forecast`) (TC-REPORTING-REPORTS-030, TC-REPORTING-REPORTS-031)
- [ ] 5.3 Verificación de reconciliación del nightly sobre los 60 meses del Large Seed, con fallo que nombra reporte, periodo y moneda (TC-REPORTING-REPORTS-029)
- [ ] 5.4 Regla de alerta `ReportsReadModelRecommended` (p95 de 7 días > 600 ms por reporte) en las reglas de Prometheus del stack (TC-REPORTING-REPORTS-032)

## 6. API

- [ ] 6.1 OpenAPI: 15 operaciones, parámetros comunes, esquemas `Report*`, `REPORT_EXPORT_TOO_LARGE` en la descripción de `ErrorCode`, `x-rate-limit: costly` en las exportaciones; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas
- [ ] 6.2 Controllers con `ETag`/304 y `cache-control` (TC-REPORTING-REPORTS-024); tests de API de roles, aislamiento, 404 de cuenta ajena, `CURRENCY_NOT_ENABLED`, `VALIDATION_FAILED` y `REPORT_EXPORT_TOO_LARGE` (TC-REPORTING-REPORTS-003, TC-REPORTING-REPORTS-007, TC-REPORTING-REPORTS-015, TC-REPORTING-REPORTS-021, TC-REPORTING-REPORTS-025)

## 7. UI

- [ ] 7.1 Sección `/reportes` (catálogo con estados y enlaces a vistas existentes) y `/reportes/<slug>` de los seis reportes con barra de filtros en la URL, gráficos SVG con tabla equivalente, variación con texto e icono, bloque "Cómo se convirtió", panel de drill-down paginado y exportación CSV; i18n es/en/pt; axe y móvil (TC-REPORTING-REPORTS-026)
- [ ] 7.2 Enlace de Q7 del Home al reporte de ingresos y gastos con la misma comparación (TC-REPORTING-REPORTS-038)

## 8. TESTS AUTOMATIZADOS y E2E

- [ ] 8.1 E2E: registrar el mes de los scenarios, abrir "Gastos por categoría", entrar a "Supermercado", llegar a la transacción y exportar el CSV; comparar con el mes anterior; con `PF_E2E_PROJECT` (TC-REPORTING-REPORTS-026)
- [ ] 8.2 Regresión: TC-REPORTING-DASHBOARD-\*, TC-REPORTING-KPI-\*, TC-REPORTING-NETWORTH-\*, TC-FX-COST-\*, TC-PLATFORM-EVENTS-018 (el worker arranca con los mismos consumidores)

## 9. DOCS

- [ ] 9.1 Aplicar la lista "Cambios a docs compartidos" de design.md (docs/01, 02, 03, 10, 14, 16, 23, 28 y 38) en el PR de implementación
- [ ] 9.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `pnpm spec:validate`
