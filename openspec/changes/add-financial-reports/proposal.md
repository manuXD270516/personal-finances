# Propuesta: add-financial-reports

## Why

docs/24 §5.7 fija como objetivo de Phase 7 "16 reportes con drill-down" y como criterios de salida SM-05, NFR-PERF-006/010 con el seed `large` y un **test de reconciliación reporte↔ledger**. Hoy REPORTING responde las 9 preguntas del Home y tiene tres vistas sueltas (evolución del patrimonio, próximos pagos, costo de conversiones), pero no hay reportes de ingresos y gastos por periodo, gastos por categoría, flujo de caja histórico ni historial de saldo; no hay comparaciones MoM/YoY/rango/móviles (FR-REPORTING-009), drill-down hasta los movimientos (FR-REPORTING-010), una política de conversión visible por reporte (FR-REPORTING-011) ni export CSV de reportes (FR-REPORTING-012). FR-REPORTING-008 marca como Must los reportes 1, 2, 3, 7, 8 y 15.

Este change entrega el **núcleo Must** del catálogo y la infraestructura común que reutilizan todos los reportes. Los reportes Should (4, 5, 6, 9–14), las vistas guardadas (FR-REPORTING-019) y el PDF (FR-REPORTING-013, Could) van en el change hermano `add-financial-reports-extended`, que depende de este (ver design.md decisión 1 para la justificación de la partición).

## What Changes

- **Capability nueva `reporting/financial-reports`** con el catálogo de los 16 reportes (estado por reporte: disponible, parcial o planificado; el 16 queda en Phase 8) y cinco reportes Must: (1) ingresos vs gastos (por periodo o por semana, con ahorro y tasa de ahorro), (2) presupuesto vs real por periodos (compone la consulta de PLANNING sin recalcular), (3) gastos por categoría (grupo → categoría → subcategoría, top N y neto negativo visible), (7) flujo de caja histórico de las cuentas líquidas (componentes operativo, deuda, ahorro e inversión, cambio de moneda y ajustes, con la identidad saldo inicial + componentes = saldo final por moneda) y (15) historial diario de saldo de una cuenta con marcas de conciliación.
- **Filtros comunes** (cuentas, monedas, categorías, etiquetas, contrapartes), **periodo financiero o mes calendario** (hasta 24 periodos) y **comparaciones**: periodo anterior (MoM), año anterior (YoY), rango personalizado con normalización por día, promedio móvil de 3/6/12 periodos completos y, Should, comparación "a la fecha" del periodo en curso.
- **Política de conversión explícita** en cada respuesta (D109, `FlowValuation`): flujos a la tasa de su fecha, saldos a la fecha de valoración, moneda de reporte seleccionable entre las habilitadas, vista por moneda nativa siempre presente, montos sin tasa fuera del consolidado (`complete`, `unconverted[]`, nunca 1:1); Should: flujos a la tasa de la fecha de corte a pedido.
- **Drill-down** de cualquier celda a sus porciones (splits), movimientos de liquidez o movimientos de la cuenta, con los mismos filtros, paginado por cursor y con la identidad Σ filas = celda (nativa y consolidada).
- **Export CSV** de cada reporte y de cada drill-down (UTF-8 con BOM, neutralización de fórmulas, cuota `costly`, tope de 50 000 filas con el código nuevo `REPORT_EXPORT_TOO_LARGE`); Should: auditoría de cada exportación.
- **`reporting/net-worth` (Phase 7 del reporte 8):** descomposición exacta del cambio del patrimonio (ahorro, resultado de conversiones, ajustes, revalorización cambiaria y de activos por moneda, otros movimientos con cuentas fuera del patrimonio), incompleta sin tasa; Should: serie diaria y drill-down a cuentas.
- **`reporting/dashboard`:** Should: la comparación del Home (Q7) enlaza al reporte de ingresos y gastos con la misma comparación.
- **Reconciliación reporte↔ledger** (criterio de salida): identidades verificadas por PBT sobre ledgers aleatorios, por integración con el dataset Demo v2 y en el nightly con el Large Seed (60 meses).
- **NFR-PERF-006 con el seed `large`:** cada reporte de 12 meses p95 ≤ 800 ms y el drill-down p95 ≤ 300 ms en filas bloqueantes de `nightly.perf.ts`. **Sin read models, sin consumidores nuevos y sin cambio del presupuesto de conexiones**: los reportes leen por conjunto (agregados SQL por día, moneda y dimensión) a través de contratos públicos; los read models de docs/14 §2.1 quedan como evolución condicionada a una métrica y una alerta (Should).
- **Fuera de alcance:** reportes 4, 5, 6, 9–14, vistas guardadas y PDF (`add-financial-reports-extended`); reporte 16 (Phase 8); cash-flow calendar, NFR-PERF-010 y la variación por categoría de Q7 (`add-cash-flow-forecast`, en paralelo); presupuestos por historial y reglas sugeridas (`add-historical-budgets` y `add-rule-suggestions`, en paralelo); endpoint `kpis` y destino de `summary` (D55, pregunta 7); export XLSX y JSON; caché Redis de reportes; valoración de commodities e inversiones (D221).

## Capabilities

### New Capabilities

- `reporting/financial-reports`: catálogo, filtros, periodos, comparaciones, política de conversión, cinco reportes Must, drill-down, CSV, frescura, acceso, UI, reconciliación con el ledger y rendimiento (29 requirements: 25 Must, 4 Should).

### Modified Capabilities

- `reporting/net-worth`: descomposición del cambio del patrimonio, descomposición incompleta, movimientos con cuentas excluidas, serie diaria y drill-down a cuentas (5 requirements ADDED: 3 Must, 2 Should).
- `reporting/dashboard`: detalle de la comparación del Home en los reportes (1 requirement ADDED, Should).

## Impact

**Specs impactadas:** `reporting/financial-reports` (nueva), `reporting/net-worth`, `reporting/dashboard`. Leídas sin cambios: `planning/budgets`, `planning/financial-periods`, `planning/month-closing`, `transactions/transaction-recording`, `transactions/splits`, `transactions/reconciliation`, `ledger/balances`, `fx/market-rates`, `fx/market-rate-providers`, `accounts/account-management`, `classification/categories`, `audit/audit-trail`, `security/access-control`, `platform/event-delivery` (sin consumidores nuevos). No toca `reporting/cash-flow-calendar` ni `planning/*` (changes en paralelo).

**Componentes/contextos impactados:** REPORTING (dominio: `ReportPeriodCalendar`, `ReportComparator`, `ReportConversionPolicy`, `IncomeExpenseReport`, `CategoryTreeReport`, `LiquidityFlowReport`, `BalanceStepSeries`, `NetWorthDecomposer`, `DrillDownSpec`; aplicación: una query por reporte, `GetReportDrillDown`, exportadores CSV; interface: controllers). TRANSACTIONS: `NominalFlowQuery.summarizeNominalFlows` con filtros y agrupaciones opcionales (aditivo) y consulta nueva `NominalPortionQuery.listPortions`. LEDGER: consulta nueva `AccountSetFlowQuery` (`summarize` y `listMovements`). PLANNING: solo se consume `BudgetVsActualQuery` y `PeriodQuery` existentes (puertos declarados en REPORTING, adapter en la composición). AUDIT: Should, `AuditPort` para la exportación. `apps/api`, `apps/web` (sección "Reportes").

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: `GET W/reports/catalog`, `GET W/reports/income-expenses`, `GET W/reports/expenses/by-category`, `GET W/reports/budget-vs-actual`, `GET W/reports/cash-flow`, `GET W/reports/accounts/{accountId}/balance-history`, `GET W/reports/net-worth`, `GET W/reports/drill-down` y sus `…/export` (CSV); parámetros y esquemas comunes `Report*`; código nuevo `REPORT_EXPORT_TOO_LARGE` en `ErrorCode` (`x-extensible-enum`). `pnpm contract:breaking` limpio.

**Tablas impactadas:** ninguna nueva. Índices posibles (expand, solo si el plan medido los pide): `transactions.split (workspace_id, business_date)` o equivalente para el drill-down por cursor (design.md decisión 9).

**Eventos impactados:** ninguno nuevo; no se consume ningún evento nuevo. La frescura usa la versión de datos que ya mantiene `DataVersionProjector`.

**Migraciones requeridas:** a lo sumo índices expand-only no destructivos (`CREATE INDEX CONCURRENTLY` en migración aparte), con timestamp posterior a la última de `main`.

**Test cases:** AÑADIDOS: TC-REPORTING-REPORTS-001..038 (38). MODIFICADOS: ninguno. DEPRECADOS: ninguno. Regresión: TC-REPORTING-DASHBOARD-\*, TC-REPORTING-KPI-\*, TC-REPORTING-NETWORTH-\*, TC-FX-COST-\*, TC-PLATFORM-EVENTS-018.

**Impacto de regresión:** el resumen del Home, la evolución del patrimonio y el costo de conversiones no cambian (solo se agrega el enlace de Q7); los cambios aditivos de `NominalFlowQuery` conservan la agrupación actual cuando no se piden; el worker arranca con los mismos consumidores.

**Riesgos introducidos:** RISK-029 (rendimiento de reportes de 12 meses sin read models; mitigado por consultas por conjunto, fila bloqueante del nightly y alerta de evolución); RISK-017 (valoración multi-moneda: nunca 1:1, política visible); costo de exportaciones grandes (tope de filas y cuota `costly`).

**Invariantes afectadas:** INV-001/002/020 (Decimal con moneda, HALF_EVEN solo al presentar), INV-004 (cuadre por moneda, base de la clasificación de flujos por contrapartida), INV-012 (flujos a la tasa de su fecha), INV-021/024 (porciones = movimientos nominales, base de la reconciliación), INV-022 (saldo = Σ movimientos), INV-025 (aislamiento), INV-031 (identidad de valoración, base de la descomposición del patrimonio), INV-033 (recategorizar no toca el ledger: el reporte lo refleja en la siguiente lectura).
