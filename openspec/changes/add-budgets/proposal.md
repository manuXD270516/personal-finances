# Propuesta: add-budgets

## Why

Phase 1 responde cuánto ingresó y cuánto se gastó, pero no si eso está dentro de lo planeado. El objetivo de Phase 2 (docs/24 §5.2) es "planificar el mes, controlar presupuestos con alertas y cerrar meses con snapshot inmutable"; su exit criteria exige "alertas de umbral entregadas exactamente una vez". Este change convierte FR-PLANNING-008 y FR-PLANNING-015..024 (docs/01 §8.2–§8.3) en comportamiento verificable sobre la capability `planning/budgets`: el plan mensual de cada periodo financiero, los tipos de presupuesto priorizados (fixed/maximum Must; minimum/range/rollover/% de ingresos Should; zero-based y tag Could), el presupuesto vs real derivado de las transacciones (INV-034) en moneda base con las reglas de valoración de flujos de Reporting (docs/31 D29/D34/D53) y el hecho `planning.BudgetThresholdReached.v1` emitido una sola vez por umbral y periodo, que consume `add-alerts`. También deja lista la query de presupuesto vs real que congela el snapshot de cierre (FR-PLANNING-004, `add-month-closing`) y el insumo "disponible para gastar" de Q5.

## What Changes

- **Plan mensual por periodo** (`Budget`, uno por periodo financiero de `add-financial-periods`, en la moneda base del workspace): líneas de **gasto** por categoría (incluye subcategorías), grupo (Should) o tag (Could) y líneas de **ingreso esperado** por categoría de ingreso.
- **Tipos de línea:** `FIXED` y `MAXIMUM` (Must); `MINIMUM`, `RANGE`, rollover (`CARRY_POSITIVE`/`CARRY_ALL` con tope opcional, provisional hasta el cierre del periodo anterior) y `PERCENT_OF_INCOME` (sobre ingresos esperados o reales) (Should); modo **base cero** con "por asignar" (Could).
- **Presupuesto vs real:** gastado derivado de los flujos nominales de transacciones `posted|cleared|reconciled` (neto de reembolsos, sin transferencias/conversiones salvo sus comisiones), por fecha de negocio en la TZ del workspace; montos en otra moneda convertidos con la tasa de valoración al cierre de su día (mismas reglas que Reporting: `PARALLEL` del provider con fallback, ventana del setting de Reporting, D53); sin tasa ⇒ parte sin convertir e incompleto, nunca 1:1.
- **Progreso por línea:** planificado efectivo, gastado, restante, % de uso, proyección lineal y estado (texto + icono, no solo color); **disponible para gastar** agregado sin doble conteo (no se permiten objetivos solapados en un plan).
- **Umbrales** 50/75/90/100 % por defecto o personalizados (hasta 10, ≤ 1000 %); cruce registrado y emitido **una sola vez** por objetivo, umbral y periodo (tabla de cruces + outbox en la misma transacción); varios umbrales cruzados a la vez ⇒ un solo hecho con el más alto.
- Plan de periodo cerrado inmutable (`PERIOD_CLOSED`); permisos (VIEWER lee, EDITOR/OWNER escriben) y auditoría síncrona de cada cambio.
- **Fuera de alcance:** templates, clonado del plan anterior y aplicación a futuro (`add-budget-templates`); notificaciones in-app/email (`add-alerts`); periodos y su ciclo de vida (`add-financial-periods`); cierre de mes, snapshot y bloqueo (`add-month-closing`); aportes a metas, pagos de deuda y compromisos esperados en el plan (FR-PLANNING-008 parcial: Phases 3/4 los agregan como líneas nuevas); presupuestos `average-based`/`historical-based` (FR-PLANNING-021, Phase 7); presupuestos multi-moneda (un plan por periodo en moneda base; ver design.md, pregunta 1); reporte `GET /reports/budget-vs-actual` y proyección `reporting.budget_snapshot` (Phase 7); "safe to spend" completo (Q5, Phases 3–4/7); recorrido de ciclo de vida de planes (ver pregunta 6).

## Capabilities

### New Capabilities
- `planning/budgets`: plan mensual por periodo, tipos de presupuesto, presupuesto vs real multi-moneda en moneda base, progreso, disponible para gastar y umbrales con emisión única (26 requirements: 18 Must, 6 Should, 2 Could).

### Modified Capabilities
- Ninguna. (Requiere ampliaciones **no normativas** de contratos públicos: `NominalFlowQuery` de Transactions con `tagIds` por fila para presupuestos por tag (Could) y `CategoryCatalogQuery` de Classification con el árbol grupo → categoría → subcategoría; ver design.md § Contratos.)

## Impact

**Specs impactadas:** crea `planning/budgets`. Lee comportamiento de `planning/financial-periods` (estados del periodo y rango de fechas; `add-financial-periods`), `transactions/transaction-recording` (estados, reembolsos, flujos nominales), `transactions/transfers` y `transactions/conversions` (comisiones), `classification/categories` (jerarquía, grupos, archivado; `add-classification`), `classification/tags`, `fx/market-rates` y `fx/market-rate-providers` (selección de tasa de valoración), `reporting/dashboard` (reglas de flujos y ventana de vigencia D53), `audit/audit-trail` y `security/access-control`.

**Componentes/contextos impactados:** Planning (`@pf/planning`, nuevo paquete si `add-financial-periods` no lo crea): domain `Budget`/`BudgetLine` (VO `BudgetLineKind`, `Threshold`, `RolloverPolicy`), DS puros `BudgetProgressCalculator`, `ThresholdEvaluator`, `RolloverCalculator`; application `CreateBudget`, `AddBudgetLine`, `UpdateBudgetLine`, `RemoveBudgetLine`, `GetBudgetVsActual`, consumidor `planning.budget-thresholds`; infrastructure repositorios Kysely y adapters a `@pf/transactions/contracts`, `@pf/classification/contracts`, `@pf/fx/contracts`, `@pf/audit/contracts`. `@pf/shared-kernel`: se extrae la valoración pura de flujos (`FlowValuation`: agregado por moneda y día, conversión única, HALF_EVEN al presentar) hoy en `ConsolidationService` de Reporting, sin cambio de comportamiento. `apps/api` (controller `budgets`), `apps/worker` (consumidor), `apps/web` (pantalla Presupuestos y `BudgetProgressWidget` del Home).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nuevas `GET/POST W/budgets`, `GET W/budgets/{budgetId}`, `GET W/periods/{periodId}/budget`, `POST W/budgets/{budgetId}/lines`, `PATCH|DELETE W/budgets/{budgetId}/lines/{lineId}`; schemas `Budget`, `BudgetLine`, `BudgetLineProgress`, `BudgetTotals`; códigos `BUDGET_ALREADY_EXISTS` (ya listado en docs/10), `BUDGET_LINE_DUPLICATE_TARGET`, `BUDGET_TARGET_OVERLAP`, `BUDGET_INVALID_AMOUNTS`, `BUDGET_INVALID_LINE_KIND`, `BUDGET_THRESHOLD_INVALID`. Detalle en design.md § Contratos.

**Tablas impactadas:** nuevas `planning.budget`, `planning.budget_line`, `planning.budget_threshold_crossing` (append-only); lectura de `planning.financial_period` (de `add-financial-periods`); `platform.outbox` / `platform.inbox`; `audit.audit_log`.

**Eventos impactados:** produce `planning.BudgetCreated.v1` y `planning.BudgetThresholdReached.v1` (nuevos, `contracts/events/planning/`). Consume `transactions.TransactionPosted.v1`, `TransactionVoided.v1`, `TransactionCategorized.v1`, `TransactionUpdated.v1`, `TransferCompleted.v1`, `TransferRevised.v1`, `ConversionRecorded.v1`, `ConversionRevised.v1`, `fx.RateRecorded.v1` y los eventos de cierre/reapertura de periodo de `add-financial-periods`/`add-month-closing` (`planning.MonthClosed.v1`, `planning.PeriodReopened.v1`, docs/11).

**Migraciones requeridas:** expand, no destructiva: tablas nuevas en el schema `planning` (lo crea `add-financial-periods`; `CREATE SCHEMA IF NOT EXISTS` por robustez), RLS por `workspace_id`, grants (`budget_threshold_crossing` solo `SELECT, INSERT` + `platform.forbid_mutation()`), registro en `platform.workspace_scoped_table` (purga demo, ADR-0026).

**Test cases:** AÑADIDOS — TC-PLANNING-BUDGET-001..021, TC-PLANNING-ACTUAL-001..007, TC-PLANNING-THRESHOLD-001..007 (35). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** ningún comportamiento previo cambia. La extracción de `FlowValuation` al shared-kernel debe dejar en verde TC-REPORTING-KPI-001..010 y TC-REPORTING-DASHBOARD-* (refactor sin cambio de comportamiento). El presupuesto vs real pasa a ser un segundo oráculo de la clasificación de flujos: un cambio en `SummarizeNominalFlows` que altere gastos romperá TC-PLANNING-ACTUAL-*. Nuevo consumidor en el worker: vigilar `outbox_lag_seconds` (NFR-PERF-008).

**Riesgos introducidos:** RISK-005 (tipos de presupuesto exóticos y sobre-ingeniería: Must acotado a fixed/maximum; Should/Could detrás de `BudgetLineKind` sin infraestructura extra), RISK-017 (multi-moneda: mitigado reusando la valoración de Reporting e informando lo no convertido), RISK-020 (bordes de periodo/TZ: fecha de negocio + TZ del workspace), RISK-022 (consistencia eventual del cruce de umbrales: lectura directa para el progreso; el hecho de umbral llega con lag ≤ 5 s p95).

**Invariantes afectadas:** INV-001, INV-002, INV-003, INV-012, INV-015, INV-020, INV-023, INV-025, INV-028, INV-029, INV-034 (ninguna escritura en el ledger).
