# Propuesta: add-net-worth-evolution

## Why

Phase 1 responde "¿cuánto valgo hoy?" (`reporting/net-worth`), pero no "¿cómo evolucionó?". FR-REPORTING-006 (Should, Phase 2) pide la evolución mensual del patrimonio neto desde los snapshots de cierre o por cálculo as-of, y docs/24 §5.2 incluye "evolución de net worth" en el alcance de Phase 2. Con el cierre de mes de Phase 2 (snapshots inmutables, pf-p2a) la serie de meses cerrados queda estable y explicable; para meses abiertos se calcula a partir del ledger y de las tasas históricas, sin read models (D15: los read models llegan en Phase 7).

## What Changes

- Nuevo endpoint `GET W/reports/net-worth/history` (VIEWER+) con la serie por periodo financiero mensual de `planning/financial-periods` (fin del periodo; con día de inicio 1, fin de mes calendario): activos, pasivos, patrimonio neto, completitud, saldos no valorados, fuente del punto (`SNAPSHOT` de cierre o `COMPUTED`), parcialidad del mes en curso y variación respecto al mes anterior.
- Valoración de cada punto con la tasa vigente a su fecha (mismo selector de valoración de FX y ventana de vigencia de REPORTING, D53), nunca con la tasa de hoy; tasas usadas y atribuciones informadas.
- Meses cerrados desde el snapshot vigente de `planning/month-closing` (cuando exista); meses abiertos por cálculo as-of desde el ledger.
- Cuentas consideradas según su saldo a cada fecha (incluidas las hoy archivadas/cerradas).
- Widget/gráfico "Evolución del patrimonio" en el Home o en una vista de patrimonio (línea + barras de activos/pasivos), con indicación de puntos incompletos y cerrados.
- **Fuera de alcance:** descomposición del cambio (ahorro vs revaluación FX vs ajustes, docs/14 §4.1 — Phase 7, reporte 8 "Net Worth"), granularidad diaria/semanal, read models `reporting.net_worth_snapshot`/`daily_balance` (Phase 7), valoración de activos no monetarios (FR-REPORTING-017, Phase 5), export CSV/PDF del reporte (Phase 7).

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `reporting/net-worth`: ADDED 7 requirements de evolución mensual (serie, valoración histórica, punto incompleto, meses cerrados, cuentas por fecha, variación, rango). No se modifican los requirements de Phase 1.

## Impact

**Specs impactadas:** `reporting/net-worth` (+7 requirements, Should).

**Componentes/contextos impactados:** REPORTING (`@pf/reporting`): query `GetNetWorthHistory` (application), servicio puro `NetWorthSeriesBuilder` (domain); puertos consumidos: `LedgerQueryPort.getAccountBalancesAsOf(dates[])` (LEDGER, saldos as-of en lote), `AccountDirectory` (cuentas con fechas de apertura/archivo e `includeInNetWorth`), `ValuationRateSelector` (FX, con `windowDays` del setting de REPORTING, D53), `ClosingSnapshotQuery` (PLANNING, opcional: snapshot vigente por mes). `apps/api` (controller `reports`) y `apps/web` (gráfico).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nueva `getNetWorthHistory` (`GET W/reports/net-worth/history?from=YYYY-MM&to=YYYY-MM&reportingCurrency=`), schemas `NetWorthHistory`, `NetWorthPoint`. Sin códigos nuevos (`VALIDATION_FAILED`, `CURRENCY_NOT_ENABLED`).

**Tablas impactadas:** ninguna nueva; lectura de `ledger.posting`/`ledger.balance_snapshot`, `fx.exchange_rate`, `accounts.account` (vía puertos) y de los snapshots de cierre de PLANNING (pf-p2a).

**Eventos impactados:** ninguno nuevo; la respuesta usa el `ETag` por versión de datos del workspace (`reporting.workspace_data_version`, `add-basic-dashboard`) y se invalida con los eventos que ya lo invalidan más `planning.MonthClosed`/`planning.PeriodReopened` (pf-p2a).

**Migraciones requeridas:** ninguna.

**Invariantes afectadas:** INV-012 (no se recalcula historia con tasas actuales), INV-022 (saldos as-of = Σ postings), INV-031 (identidad de valoración), NFR-DATA-006 (snapshots de cierre inmutables).

**Test cases:** AÑADIDOS — TC-REPORTING-NETWORTH-006..012 (`draft`/`ready`, `not_automated`). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** reutiliza el selector de valoración y el cálculo de patrimonio de Phase 1; los TC-REPORTING-NETWORTH-001..005 deben seguir verdes (el punto del mes en curso debe coincidir con el patrimonio actual cuando la fecha es hoy).

**Riesgos introducidos:** rendimiento con 120 meses × N cuentas (objetivo p95 ≤ 800 ms con 24 meses y dataset `large`, alineado con NFR-PERF-006; saldos as-of en lote con `balance_snapshot`); divergencia entre el punto calculado y el snapshot de un mes cerrado (por diseño se muestra el snapshot y se marca); RISK-020 (fin de mes en la zona horaria del workspace).
