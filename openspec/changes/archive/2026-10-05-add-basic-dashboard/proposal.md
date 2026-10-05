# Propuesta: add-basic-dashboard

## Why

Con cuentas, transacciones, transferencias y conversiones registradas, el owner necesita que el Home responda en segundos las preguntas básicas de su dinero sin abrir una hoja de cálculo. ARCHITECTURE §13 adelanta el **reporting básico incremental a Phase 1** (saldos, ingresos/gastos del mes) y docs/00 §6 fija que en Phase 1 se responden Q1 (¿cuánto dinero tengo?), Q2 (¿cuánto ingresó?), Q3 (¿cuánto gasté?), Q6 (¿cuánto ahorré?) y Q7 básico (¿cómo estoy vs el mes pasado?), más el patrimonio neto actual. Este change convierte las fórmulas de docs/14 §4–§6 en comportamiento verificable sobre el endpoint `/reports/summary` (docs/10).

## What Changes

- **Saldos por cuenta y totales por moneda** (sin conversión), solo con transacciones `posted | cleared | reconciled`.
- **Dinero disponible consolidado en BOB** (cuentas de activo líquidas): USD y USDT se valoran con la **última tasa `PARALLEL` del provider de mercado a la fecha** (paralelo.bo, respaldo bo.dolarapi.com; change `add-market-rate-providers`, docs/31 D29), mostrando tasa, tipo, fuente con atribución ("Fuente: paralelo.bo", CC BY 4.0), vigencia y antigüedad; si los providers no tienen tasa vigente → última tasa conocida marcada obsoleta o la última tasa manual si es más reciente; sin ninguna tasa en la ventana de 7 días → monto en moneda original, excluido del consolidado y advertido (nunca 1:1). Otras monedas: tipo preferido del par (tasas manuales).
- **Ingresos del mes** (excluye transferencias, conversiones, saldos iniciales, ajustes y reembolsos), **gastos del mes** netos de reembolsos (incluye fees de conversión; excluye transferencias y pagos de tarjeta), **ahorro** = ingresos − gastos y **tasa de ahorro** (no definida si no hay ingresos).
- **Flujos** convertidos con la tasa de la fecha de cada transacción (los meses pasados no cambian con tasas nuevas).
- **Top-N categorías** de gasto del mes y **comparación básica con el mes anterior** (a la misma fecha para el mes en curso; "nuevo" si el anterior es cero).
- **Patrimonio neto actual** = activos − pasivos de cuentas incluidas en el patrimonio, con desglose por moneda y tipo de cuenta, marcado incompleto si falta alguna tasa.
- Widgets de preguntas no habilitadas en Phase 1 (Q4, Q5, Q8, Q9) **declaran explícitamente** que no están disponibles.
- **Fuera de alcance:** safe to spend, comprometido y cash-flow calendar (Phase 3/7); presupuestos y budget utilization (Phase 2); metas y deudas (Phase 4); evolución histórica del patrimonio y su descomposición (FR-REPORTING-006, Phase 2/7); catálogo de 16 reportes, drill-down, YoY, ventanas móviles y exports (Phase 7); dashboard configurable (`DashboardLayout`) y `GET /reports/dashboard`; proyecciones materializadas (`txn_fact`, `monthly_category_agg`, `daily_balance`, `net_worth_snapshot`) — Phase 1 consulta la fuente de verdad directamente (docs/14 §2.2); valoración de inversiones/commodities (Phase 5); periodo por `FinancialPeriod` (solo mes calendario).

## Capabilities

### New Capabilities
- `reporting/dashboard`: KPIs del Home de Phase 1 (saldos, dinero disponible valorado con la tasa paralela del provider y fallback, ingresos, gastos, ahorro, top categorías, comparación MoM, honestidad ante datos faltantes) (15 requirements).
- `reporting/net-worth`: patrimonio neto actual con desglose y valoración explícita (5 requirements; solo net worth actual en Phase 1).

### Modified Capabilities
- Ninguna.

## Impact

**Specs impactadas:** crea `reporting/dashboard` y `reporting/net-worth`. Lee comportamiento de `ledger/balances`, `transactions/transaction-recording`, `transactions/transfers`, `transactions/conversions`, `classification/categories`, `accounts/account-management`, `fx/market-rates` y `fx/market-rate-providers` (selección con fallback, obsolescencia y atribución). Nota: FR-REPORTING-004 está asignado en docs/01 a `reporting/financial-reports`; aquí se especifica su parte del Home dentro de `reporting/dashboard` (el reporte completo sigue en `reporting/financial-reports`, Phase 7).

**Componentes/contextos impactados:** Reporting (`@pf/reporting`: domain `KpiCalculator`, `NetWorthValuator`, `PeriodComparator` como funciones puras; application `GetReportSummary`; infrastructure adapters a contratos públicos de Ledger, Transactions, Accounts, Classification y FX; consumidor de eventos para `dataVersion`); queries públicas nuevas en Ledger (`GetBalances` por lote as-of), Transactions (`SummarizeNominalFlows`) y FX (`ConvertForValuation`, ya definida en `add-manual-conversions` y ampliada por `add-market-rate-providers` con selección por provider); `apps/api` (controller `reports`); `apps/web` (Home: `LiquidBalanceCard` y `NetWorthCard` con `RateSourceBadge` de atribución y antigüedad, ingresos/gastos/ahorro, `TopCategoriesWidget`, widgets "no disponible").

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — modifica `GET W/reports/summary` (parámetro `compare`, descripción de fuente) y el schema `ReportSummary` (consolidado siempre presente con `complete`/`unconverted`, saldos por cuenta con equivalente y tasa, comparación, patrimonio neto con desglose, disponibilidad de preguntas, `ratesUsed` como `ResolvedRate` con `provider`/`selection`/`stale`/`attribution`, y `meta.attributions`). Detalle en design.md §Contratos.

**Tablas impactadas:** nueva `reporting.workspace_data_version` (derivada, DRV); lectura vía contratos de `ledger.posting`, `ledger.balance_snapshot`, `txn.transaction`, `txn.transaction_split`, `accounts.account`, `classification.category`, `fx.exchange_rate` (manuales y de provider), `fx.rate_preference`; `platform.inbox` para el consumidor.

**Eventos impactados:** ninguno producido. Consume (solo para invalidar caché/ETag por `dataVersion`) `ledger.JournalEntryPosted.v1`, `transactions.TransactionPosted.v1`, `transactions.TransactionVoided.v1`, `transactions.TransactionCategorized.v1`, `accounts.AccountOpened.v1`, `accounts.AccountArchived.v1` y `fx.RateRecorded.v1` (lo crea `add-manual-conversions`; `add-market-rate-providers` lo emite también por cada tasa de provider).

**Migraciones requeridas:** expand, no destructiva: schema `reporting` (si no existe), tabla `reporting.workspace_data_version`, grants DRV (`pf_worker` escribe, `pf_app` lee) y RLS por `workspace_id`; índices de lectura de docs/14 §11 sobre `ledger.posting (workspace_id, ledger_account_id, entry_date) INCLUDE (amount)` si `add-ledger-core` no los creó.

**Test cases:** AÑADIDOS (2026-10-03, docs/31 D34/D35) — TC-REPORTING-DASHBOARD-008, TC-REPORTING-DASHBOARD-009. AÑADIDOS — TC-REPORTING-DASHBOARD-001, TC-REPORTING-DASHBOARD-002, TC-REPORTING-DASHBOARD-003, TC-REPORTING-DASHBOARD-004, TC-REPORTING-DASHBOARD-005, TC-REPORTING-DASHBOARD-006, TC-REPORTING-DASHBOARD-007, TC-REPORTING-KPI-001, TC-REPORTING-KPI-002, TC-REPORTING-KPI-003, TC-REPORTING-KPI-004, TC-REPORTING-KPI-005, TC-REPORTING-KPI-006, TC-REPORTING-KPI-007, TC-REPORTING-KPI-008, TC-REPORTING-NETWORTH-001, TC-REPORTING-NETWORTH-002, TC-REPORTING-NETWORTH-003, TC-REPORTING-NETWORTH-004, TC-REPORTING-NETWORTH-005 (TC-REPORTING-DASHBOARD-002/003/004, TC-REPORTING-KPI-003 y TC-REPORTING-NETWORTH-001..004 se recalcularon el 2026-10-02 con la tasa `PARALLEL` 12.02 del provider, docs/31 D29). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** ningún comportamiento previo de reporting. Los KPIs pasan a ser oráculo de regresión de la clasificación de transacciones (transfer/conversión/refund no son ingreso ni gasto): cualquier cambio en el mapeo a postings de docs/09 §6 que altere ingresos o gastos romperá TC-REPORTING-KPI-*. Latencia del Home sujeta a NFR-PERF-004 (p95 ≤ 300 ms).

**Riesgos introducidos:** RISK-017 (complejidad multi-moneda: tasas faltantes y consolidado incompleto), RISK-023 (la valoración principal depende de providers de terceros; mitigado con fallback a respaldo, última conocida marcada obsoleta y tasa manual), RISK-020 (bordes de mes y zona horaria), RISK-022 (inconsistencia visible; mitigado leyendo la fuente de verdad en Phase 1), RISK-029 (rendimiento con historia larga; mitigado con snapshots de saldo e índices).

**Invariantes afectadas:** INV-009, INV-012, INV-020, INV-022, INV-023, INV-025, INV-028, INV-031 (solo lectura; ninguna escritura financiera).
