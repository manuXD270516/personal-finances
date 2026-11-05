# Diseño: add-financial-reports

## Contexto

REPORTING (`packages/contexts/reporting`) no tiene read models: todas sus vistas leen la fuente de verdad en la transacción de la petición a través de contratos públicos (`AccountBalancesQuery`, `AccountBalanceHistoryQuery`, `NominalFlowQuery`, `ConversionDetailQuery`, `BudgetVsActualQuery`, `ClosingSnapshotQuery`, `FxValuationPort`), con `FlowValuation` del shared-kernel para los flujos (D109) y la única tabla propia `reporting.workspace_data_version` (versión de datos para el `ETag`, mantenida por `DataVersionProjector`). El nightly (`apps/api/test/perf/nightly.perf.ts`) ya carga el Large Seed v2 (97 374 transacciones en 60 meses en el workspace principal, 25 cuentas, ~120 categorías, 20 satélites con 56 116 transacciones) y mide dos filas de NFR-PERF-006 (`net-worth-history` 24 meses y `conversion-costs` 12 meses) con umbral p95 ≤ 800 ms. El presupuesto de conexiones del host es API 22 + worker 34 = 56 sobre `max_connections = 70` (64 de 67 útiles con las colas de pg-boss).

Decisiones que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D109 | docs/33 | `FlowValuation` del shared-kernel valora todos los flujos de los reportes (agregado por moneda y día, una conversión por agregado, HALF_EVEN solo al presentar, sin tasa ⇒ `unconverted`). |
| D29, D34, D38, D53 | docs/31 | Selección de tasa y ventana `REPORTING_RATE_VALIDITY_WINDOW` (7 días) sin cambios; nunca 1:1. |
| D55 | docs/31 | El endpoint `kpis` y el destino de `summary` los decide un change de Phase 7: aquí se deja como pregunta 7 (no se crea `kpis`). |
| D117 | docs/35 | Precedente: lectura directa con métricas y alerta que recomiendan el read model cuando haga falta. |
| D218 | docs/37 | Las alertas de déficit son de `add-cash-flow-forecast`; este change no las toca. |
| D221 | docs/41 | Sin commodities ni inversiones: la revalorización de activos cubre cripto; las valoraciones manuales siguen diferidas. |
| D246 | docs/41 | Precedente de periodo financiero por omisión con opción de mes calendario (pregunta 3). |
| D249, D311, D312, D359 | docs/41, 57, 60 | Ningún consumidor nuevo sin justificar el presupuesto; filas bloqueantes del nightly con la configuración del host. |

Contextos y capas que cambian:

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Reporting | DS puros `ReportPeriodCalendar`, `ReportComparator` (extiende `PeriodComparator`), `ReportConversionPolicy`, `IncomeExpenseReport`, `CategoryTreeReport`, `LiquidityFlowReport`, `BalanceStepSeries`, `NetWorthDecomposer`, `ReportReconciler` | domain | Nuevos (TDD, PBT) |
| Reporting | Queries `GetReportCatalog`, `GetIncomeExpensesReport`, `GetExpensesByCategoryReport`, `GetBudgetVsActualReport`, `GetCashFlowReport`, `GetAccountBalanceHistoryReport`, `GetNetWorthReport`, `GetReportDrillDown`; exportadores CSV | application | Nuevos |
| Reporting | Puertos `NominalFlowsPort`, `NominalPortionsPort`, `AccountSetFlowPort`, `BudgetVsActualPort`, `ReconciliationMarksPort`, `ReportAuditPort` | application (ports) | Nuevos (adapters en la composición) |
| Transactions | `NominalFlowQuery.summarizeNominalFlows` con filtros y `groupBy` opcionales; `NominalPortionQuery.listPortions` | application (contracts) + infrastructure | Aditivo / nuevo |
| Ledger | `AccountSetFlowQuery.summarize` y `.listMovements` | application (contracts) + infrastructure | Nuevo |
| Planning | `BudgetVsActualQuery.getForPeriod`, `PeriodQuery.listPeriods` | — | Solo se consumen (sin cambios) |
| Audit | `AuditPort` (Should, exportaciones) | — | Se consume |
| apps/api | Controllers de reportes y exportaciones | interface | Nuevo |
| apps/web | Sección `/reportes` | interface | Nueva |

## Objetivos / No objetivos

**Objetivos:**
- Los seis reportes Must de FR-REPORTING-008 con comparaciones, drill-down, política de conversión y CSV.
- Cumplir los criterios de salida que dependen de Reporting: reconciliación reporte↔ledger y NFR-PERF-006 con el seed `large`.
- No agregar consumidores, colas ni conexiones.

**No objetivos:**
- Reportes Should (4, 5, 6, 9–14), vistas guardadas y PDF: `add-financial-reports-extended`.
- Cash-flow calendar, NFR-PERF-010, alertas de déficit y variación por categoría de Q7: `add-cash-flow-forecast` (en paralelo).
- Presupuestos por historial y reglas sugeridas: `add-historical-budgets` y `add-rule-suggestions` (en paralelo).
- Read models de docs/14 §2.1, caché Redis, XLSX, JSON, `kpis`.

## Decisiones

1. **Partición en dos changes por prioridad.** `add-financial-reports` (este) lleva los reportes Must (1, 2, 3, 7, 8, 15) y **toda** la infraestructura común: catálogo, filtros, periodos, comparaciones, política de conversión, drill-down, CSV, frescura, UI base, reconciliación y medición. `add-financial-reports-extended` lleva los reportes Should (4, 5, 6, 9–14), las vistas guardadas (FR-REPORTING-019) y el PDF (FR-REPORTING-013, Could). Motivos: (a) los criterios de salida de Phase 7 que dependen de Reporting (reconciliación y NFR-PERF-006) solo exigen el núcleo; (b) el núcleo fija contratos (`AccountSetFlowQuery`, `NominalPortionQuery`, esquemas `Report*`) que los reportes Should reutilizan sin rediseño, así que implementarlos antes evita retrabajo en 9 reportes; (c) los reportes Should dependen de contratos nuevos en GOALS, DEBT y COMMITMENTS (historiales mensuales) que no bloquean el núcleo; (d) tamaño: el núcleo ya son 35 requirements y 38 TC; con los Should pasaría de 50 y de un PR revisable. Alternativas: un único change (rechazada por tamaño y porque retrasaría la salida de la fase); tres changes (núcleo, reportes por contexto, vistas/PDF), rechazada porque las vistas guardadas y el PDF son pequeños y comparten los mismos esquemas. Pregunta 2.

2. **Lectura por conjunto, sin read models ni consumidores nuevos (FR-REPORTING-007, docs/14 §1.8).** Cada reporte se compone en UNA unidad de trabajo de lectura (`ReportingUnitOfWork.run`, RLS del workspace) con consultas agregadas en SQL por (día, moneda, dimensión) a través de contratos públicos, y una sola resolución de tasas por petición (`FlowValuation.resolveRates` con todas las claves moneda|día del reporte y de su comparación). Volumen esperado con el Large Seed: 12 meses ≈ 19 500 transacciones y ≈ 24 000 porciones, que se reducen en SQL a ≲ 15 000 filas (día × categoría × moneda × naturaleza) antes de llegar a Node; las sumas con Decimal sobre ese volumen están por debajo de 50 ms. Alternativas: (b) proyecciones `monthly_category_agg`, `monthly_account_agg` y `daily_balance` alimentadas por un consumidor nuevo `reporting.financial-facts` (+1 conexión: worker 35, 57 sobre 70 y 65 de 67 útiles; además suma un consumidor más a la ráfaga del import de D311/D359, que hoy drena 15 000 hechos en ≤ 120 s por consumidor); (c) caché "read-through" de periodos cerrados en una tabla propia escrita en el GET (sin consumidor, pero con escritura en una lectura y su invalidación al reabrir). Se adopta (a) porque las dos filas de NFR-PERF-006 existentes ya pasan leyendo directo, la lectura es exacta y read-your-writes por construcción (sin lag ni rebuild), y la reconciliación con el ledger no depende de una proyección. FR-REPORTING-007 se cumple en su parte de frescura (`dataVersion`, `latestEntryAt`); su frase "los read models se introducen con los reportes avanzados" se reinterpreta como condicionada a la métrica (requirement Should "Métrica de duración y alerta de evolución a read models"). **Bloquea:** pregunta 1.

3. **Contratos de lectura nuevos (sin joins cross-schema).**
   - TRANSACTIONS amplía `summarizeNominalFlows` con filtros opcionales (`accountIds`, `counterpartyIds`, `tagIds` con coincidencia "cualquiera", `currencies`) y `groupBy` opcional (`ACCOUNT`, `COUNTERPARTY`) que agrega `accountId`/`counterpartyId` a la fila; sin ellos la consulta y su agrupación no cambian (regresión del Home y del presupuesto). La cuenta de una porción es la de la pata de usuario que paga o cobra la transacción (gasto, ingreso o reembolso); en comisiones de transferencias y conversiones, la cuenta desde la que se cobra la comisión.
   - TRANSACTIONS agrega `NominalPortionQuery.listPortions` (drill-down de porciones, keyset por `(business_date DESC, split_id DESC)`, totales por moneda de TODA la celda calculados con el mismo predicado).
   - LEDGER agrega `AccountSetFlowQuery`: dado un conjunto de cuentas del usuario y un rango, agrega por (día, moneda, clase de contrapartida) los movimientos de las patas FUERA del conjunto en asientos que tocan el conjunto, con el signo del conjunto (−Σ patas de afuera). Clases: `INCOME`, `EXPENSE`, `FX_TRADING`, `OPENING_BALANCE`, `ADJUSTMENTS` (cuentas de sistema) y `OUTSIDE_ASSET`, `OUTSIDE_LIABILITY` (cuentas del usuario fuera del conjunto). `listMovements` devuelve el detalle por (asiento, moneda, clase) con el id de la transacción de origen, paginado por cursor y con totales.
   - Las categorías (con jerarquía y archivadas) y los nombres de cuentas y contrapartes salen de los catálogos públicos en bloque (sin N+1); la subcategoría se expande a ids en REPORTING antes de llamar a TRANSACTIONS.

4. **Flujo de caja por contrapartida (INV-004).** Como cada asiento cuadra por moneda, para el conjunto L de cuentas líquidas se cumple por moneda Σ patas en L = −Σ patas fuera de L en los asientos que tocan L; clasificar las patas de afuera reparte el flujo de L sin residuo: `INCOME`/`EXPENSE` → operativo; `OUTSIDE_LIABILITY` → deuda; `OUTSIDE_ASSET` → ahorro e inversión; `FX_TRADING` → cambio de moneda; `OPENING_BALANCE`/`ADJUSTMENTS` → ajustes. Una transferencia entre cuentas de L no tiene patas de afuera y no aparece. Saldos inicial y final con `AccountBalanceHistoryQuery` (dos fechas por periodo, una llamada). Por moneda: inicial + Σ componentes = final (exacto); en el consolidado los saldos van a la tasa de su fecha y los componentes a la de cada día, y la diferencia es la línea `revaluation`. Una conversión desde una cuenta líquida hacia una no líquida de otra moneda cae en cambio de moneda (sus patas de afuera son `FX_TRADING`): se documenta en el tooltip y el drill-down lo muestra.

5. **Descomposición del patrimonio (INV-031).** Conjunto N = cuentas del usuario `ASSET`/`LIABILITY` con `includeInNetWorth` vigente (incluidas archivadas con historia). Por moneda c: `flow_c(t)` = Σ clases de `AccountSetFlowQuery` sobre N el día t. Componentes valorados con `FlowValuation` (tasa del día): ahorro = clases `INCOME`+`EXPENSE`; resultado de conversiones = `FX_TRADING`; ajustes = `OPENING_BALANCE`+`ADJUSTMENTS`; otros movimientos = `OUTSIDE_ASSET`+`OUTSIDE_LIABILITY`. Revalorización por moneda: `reval_c = bal_c(d1)·r_c(d1) − bal_c(d0⁻)·r_c(d0⁻) − Σ_t flow_c(t)·r_c(t)` (para c = moneda de reporte es 0). Por construcción ΔNW = Σ componentes + Σ_c reval_c exactamente (precisión 40, HALF_EVEN solo al presentar). Agrupación: monedas `FIAT` → cambiaria; `CRYPTO`, `COMMODITY`, `CUSTOM` → de activos (pregunta 4 sobre USDT). Sin tasa de una moneda en d0⁻, d1 o un día con flujo en c: esa moneda no se revaloriza, va a `unvalued[]` y la descomposición queda `complete: false` (no se atribuye a otro componente). El "ahorro" de la descomposición es el de las cuentas de N (un gasto pagado desde una cuenta excluida no está); el tooltip lo explica. La serie diaria usa los saldos por moneda de N (saldo inicial + Σ flujos acumulados) y una tasa por (moneda, día) de la misma resolución.

6. **Política de conversión (`ReportConversionPolicy`).** Flujos: `TRANSACTION_DATE` (tasa al cierre del día de negocio, acotada a "ahora"), o `CUTOFF_DATE` a pedido (`conversion=CUTOFF`: todas las claves moneda|día se resuelven en la fecha de corte; Should). Saldos: `VALUATION_DATE` (cierre de cada fecha). La respuesta trae `meta.conversion {policy, cutoffDate, rateWindowDays, ratesUsed[], attributions[]}`, `meta.complete` y `meta.unconverted[]`; cada cifra trae su `ReportAmount {byCurrency[], consolidated, complete, unconverted[]}`. `reportingCurrency` debe ser una moneda habilitada (`CURRENCY_NOT_ENABLED`, 422). Las cifras nativas no dependen de la moneda de reporte.

7. **Periodos y comparaciones.** `ReportPeriodCalendar` obtiene los periodos financieros por `PeriodQuery.listPeriods` (puerto declarado en REPORTING, como `FinancialPeriodsPort`; con la regla del día de inicio para periodos aún no creados, igual que `CostPeriodCalendar`) o meses calendario; máximo 24 periodos (`VALIDATION_FAILED`). Semanas ISO (lunes a domingo) solo en ingresos y gastos, máximo 106 semanas. Comparaciones (`ReportComparator`): `PREVIOUS_PERIOD` (periodo anterior del mismo tipo); `PREVIOUS_YEAR` (periodo que contiene `from − 1 año`; en meses financieros, el periodo cuyo inicio cae en esa fecha según la regla del día de inicio); `CUSTOM` (`compareFrom`, `compareTo`, ≤ 24 periodos; `normalize=PER_DAY` divide por los días de cada rango sin redondeo intermedio); `PREVIOUS_PERIOD_TO_DATE` (Should; reutiliza `PeriodComparator` del Home: días 1..N acotados al último día del mes comparado). Promedio móvil `rolling=3|6|12`: media de los N periodos completos inmediatamente anteriores a cada periodo; los anteriores al primer asiento (`LedgerActivityRangeQuery`) no cuentan; con menos de N, `insufficient: true` y sin variación. Variación: `deltaAbs = cur − prev`, `deltaPct = (cur − prev)/|prev| × 100` con 2 decimales HALF_EVEN, `isNew` si `prev = 0` y `cur ≠ 0`. El rango comparado se lee en la MISMA unidad de trabajo y su resolución de tasas se fusiona con la del rango principal.

8. **Reportes Must.**
   - *Ingresos y gastos:* `summarizeNominalFlows` (rango ∪ comparación ∪ ventana móvil) → `IncomeExpenseReport` agrega por periodo o semana; tasa de ahorro con 1 decimal HALF_EVEN, `null` con ingreso ≤ 0.
   - *Gastos por categoría:* `summarizeNominalFlows` (EXPENSE) → `CategoryTreeReport` arma grupo → categoría → subcategoría con el catálogo (archivadas incluidas), ordena por consolidado descendente (empate por nombre), `topN` 1..50 con "Otras categorías", marca `negativeNet`.
   - *Presupuesto vs real:* por cada periodo financiero del rango, `BudgetVsActualQuery.getForPeriod` (secuencial en la unidad de trabajo, nunca `Promise.all`); sin plan ⇒ `NO_BUDGET`. Las cifras son las de PLANNING (misma `FlowValuation`); REPORTING no recalcula. `grouping=CALENDAR_MONTH` ⇒ `VALIDATION_FAILED`. El drill-down de una línea usa su objetivo (categoría con subcategorías, grupo o etiqueta) y el rango del periodo.
   - *Flujo de caja:* decisión 4.
   - *Historial de saldo:* saldo de apertura al día anterior (`AccountBalancesQuery`) + deltas diarios de `AccountSetFlowQuery.summarize` sobre {cuenta}; hasta 731 días; marcas de conciliación con un puerto sobre la consulta pública de conciliaciones de TRANSACTIONS (`ReconciliationStatusQuery` o una consulta aditiva de sesiones cerradas por rango si la cobertura no alcanza; se decide al implementar sin cambiar el contrato HTTP).
   - *Patrimonio:* decisión 5; `granularity=PERIOD|DAY` (día: ≤ 366 días).

9. **Drill-down y rendimiento.** `GET W/reports/drill-down` recibe `report`, la celda (`from`, `to`, `nature`, `categoryId[]`/`categoryGroupId`, `budgetPeriodId`+`budgetLineId`, `component`, `accountId`+`date`) y los filtros comunes. Tipos de fila: `PORTION` (porciones, `NominalPortionQuery`), `LIQUIDITY_MOVEMENT` (componente del flujo de caja, `AccountSetFlowQuery.listMovements` con las clases del componente), `ACCOUNT_MOVEMENT` (día del historial) y `NET_WORTH_ACCOUNT` (cuentas de un punto o componente del patrimonio; Should). La identidad Σ filas = celda la garantiza que la celda y el drill-down usan el mismo predicado y la misma resolución de tasas; los totales viajan en cada página. Paginación por cursor opaco (keyset), `limit` 1..200 (50 por omisión). Índices: se verifican con `EXPLAIN` sobre el Large Seed; si el keyset por fecha de negocio no usa índice, se agrega en una migración expand aparte un índice `(workspace_id, business_date DESC, id DESC)` sobre la tabla de porciones (o la de transacciones), con `CREATE INDEX CONCURRENTLY`.

10. **Medición de NFR-PERF-006 en el nightly (sin consumidores).** Los reportes son lecturas síncronas: no emiten ni consumen eventos, así que la medición no necesita el worker ni cambia su pool. Filas nuevas en `nightly.perf.ts` (mismo Large Seed ya cargado, rango fijo de los 12 meses completos que terminan en el ancla del seed, 2025-10-01 → 2026-09-30, para no depender del reloj; precondición de quietud del host y orden determinista de docs/23 §5.5), cada una con `Math.max(20, ITERATIONS/4)` muestras sin `If-None-Match`:

    | id | Petición | Umbral | Gate |
    |---|---|---|---|
    | `report-income-expenses-12m` | ingresos y gastos, 12 periodos, `compare=PREVIOUS_PERIOD` | p95 ≤ 800 ms | bloqueante |
    | `report-income-expenses-12m-yoy-rolling12` | ídem con `compare=PREVIOUS_YEAR&rolling=12` (lee 36 meses) | p95 ≤ 800 ms | bloqueante (pregunta 9) |
    | `report-expenses-by-category-12m` | gastos por categoría, 12 periodos | p95 ≤ 800 ms | bloqueante |
    | `report-budget-vs-actual-12m` | presupuesto vs real con 12 presupuestos de 30 líneas creados por la prueba | p95 ≤ 800 ms | bloqueante |
    | `report-cash-flow-12m` | flujo de caja de las cuentas líquidas | p95 ≤ 800 ms | bloqueante |
    | `report-account-balance-history-12m` | historial de la cuenta con más movimientos, 365 días | p95 ≤ 800 ms | bloqueante |
    | `report-net-worth-12m` | patrimonio por periodo con descomposición | p95 ≤ 800 ms | bloqueante |
    | `report-drill-down-first-page` | primera página (50) de la categoría con más porciones de los 12 meses | p95 ≤ 300 ms | bloqueante |
    | `report-drill-down-deep-page` | página 20 por cursor de la misma celda | p95 ≤ 300 ms | bloqueante |
    | `report-export-csv` | CSV del drill-down de esa celda completa | — | informativa |
    | `report-net-worth-daily-366` | serie diaria de 366 días | p95 ≤ 800 ms | informativa (Should) |

    `PERF_THRESHOLDS['NFR-PERF-006']` agrega `drillDownLimitMs: 300` (como `allAccountsLimitMs` de NFR-PERF-005). La métrica `reporting_report_duration_seconds{report}` (histograma, `report` ∈ los 16 ids) se publica en `/metrics`; la alerta `ReportsReadModelRecommended` (p95 de 7 días > 600 ms por reporte) va en las reglas de Prometheus del stack. NFR-PERF-010 lo mide `add-cash-flow-forecast` con el mismo patrón (`PERF_THRESHOLDS['NFR-PERF-010']` p95 ≤ 500 ms); este change no la agrega para no pisar su capability.

11. **Reconciliación reporte↔ledger (criterio de salida).** Tres niveles con la MISMA batería de identidades (`ReportReconciler`, puro): (1) PBT de dominio sobre ledgers aleatorios (asientos balanceados por moneda con ingresos, gastos, reembolsos, transferencias, conversiones con comisión, cuotas de préstamo y pagos de tarjeta; tasas aleatorias > 0; timeout explícito); (2) integración con el dataset Demo v2 contra PostgreSQL; (3) nightly con el Large Seed sobre los 60 meses. Identidades: ingreso y gasto nativos por mes y moneda = diferencia de `BalanceQuery.getTrialBalance` entre cierres de mes sobre `INCOME:<c>` y `EXPENSE:<c>` (camino independiente del de los reportes, que leen porciones); Σ categorías = gasto; Σ porciones del drill-down = celda (muestreo de 50 celdas en el nightly); flujo de caja: inicial + componentes = final con saldos contables; historial de saldo = `BalanceQuery.getBalance` en 30 días al azar; descomposición: ΔNW = Σ componentes (precisión 40); consolidado = `FlowValuation.consolidate` recalculado. Tolerancia cero en nativo; el consolidado se compara sin redondear. Un fallo nombra reporte, periodo y moneda.

12. **CSV.** Mismo neutralizador (`csvCell`, `UTF8_BOM`) que el costo de conversiones y las exportaciones de auditoría; separador coma y punto decimal (pregunta 6); encabezado estable en inglés técnico (`period_label,period_from,period_to,partial,row_kind,currency,…`), con `row_kind` ∈ `NATIVE`/`CONSOLIDATED` y las columnas `conversion_policy`, `reporting_currency`, `complete`. Tope de 50 000 filas: se cuenta antes de generar; superado ⇒ 422 `REPORT_EXPORT_TOO_LARGE` (pregunta 10). Cuota `x-rate-limit: costly` (10/min). Respuesta en streaming por bloques de 1 000 filas, en la misma unidad de trabajo de lectura. Auditoría (Should, pregunta 5): `reporting.report.exported` vía `AuditPort` con `{reportId, filters, rowCount}`, sin contenido.

13. **Frescura.** `ETag` débil = `dataVersion` + hash del contenido sin `generatedAt` (como `summaryEtag`), `cache-control: private, no-cache`, 304 con `If-None-Match`. Como los reportes leen la fuente de verdad, la siguiente lectura tras un comando ya lo incluye (read-your-writes) aunque `DataVersionProjector` vaya atrasado.

14. **Catálogo.** Estático en el dominio (16 entradas con número, id, nombre i18n, propósito, fase) más el estado por despliegue: `AVAILABLE` (los 6 de este change), `PARTIAL` con `viewPath` (9 → `/goals`, 10 → `/debts`, 11 → `/recurring/suscripciones`, 13 → `/fx/costos`) y `PLANNED` (4, 5, 6, 12, 14 → `add-financial-reports-extended`; 16 → Phase 8). El change hermano los pasa a `AVAILABLE`.

15. **UI.** Ruta `/reportes` (catálogo) y `/reportes/<slug>` por reporte, enlazada desde la navegación principal; barra de filtros común con estado en la URL (compartible); gráficos SVG propios siguiendo `NetWorthEvolutionChart` (barras agrupadas, líneas, escalón y cascada; pregunta 8) con tabla de datos equivalente (NFR-USAB-105), semántica `expense-up` con texto e icono, panel lateral de drill-down con paginación y "Exportar CSV", bloque "Cómo se convirtió" con política y tasas; i18n es/en/pt, formato es-BO, axe sin violaciones y vista móvil de 1 columna. El Home enlaza Q7 a `/reportes/ingresos-gastos?grouping=CALENDAR_MONTH&compare=PREVIOUS_PERIOD_TO_DATE` (Should).

16. **Autorización y errores.** VIEWER+ en todo (`x-required-role: VIEWER`); RLS en todas las lecturas; no miembro ⇒ 403 como el resto de `W/…`. Códigos: `VALIDATION_FAILED` (400; rangos, combinaciones inválidas), `CURRENCY_NOT_ENABLED` (422), `NOT_FOUND` (404; cuenta del historial inexistente o de otro workspace), `REPORT_EXPORT_TOO_LARGE` (422, nuevo).

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (aditivo; `x-openspec-capability: reporting/financial-reports` salvo donde se indica):

| Operación | Método y ruta | Rol | Respuesta |
|---|---|---|---|
| `getReportCatalog` | `GET W/reports/catalog` | VIEWER | 200 `ReportCatalog` |
| `getIncomeExpensesReport` | `GET W/reports/income-expenses?{común}&granularity` | VIEWER | 200 `IncomeExpensesReport` |
| `exportIncomeExpensesReport` | `GET W/reports/income-expenses/export?{común}&granularity` | VIEWER | 200 `text/csv`; `x-rate-limit: costly` |
| `getExpensesByCategoryReport` | `GET W/reports/expenses/by-category?{común}&topN` | VIEWER | 200 `ExpensesByCategoryReport` |
| `exportExpensesByCategoryReport` | `GET W/reports/expenses/by-category/export?…` | VIEWER | 200 `text/csv`; costly |
| `getBudgetVsActualReport` | `GET W/reports/budget-vs-actual?from&to&reportingCurrency` | VIEWER | 200 `BudgetVsActualReport` |
| `exportBudgetVsActualReport` | `GET W/reports/budget-vs-actual/export?…` | VIEWER | 200 `text/csv`; costly |
| `getCashFlowReport` | `GET W/reports/cash-flow?{común}` | VIEWER | 200 `CashFlowReport` |
| `exportCashFlowReport` | `GET W/reports/cash-flow/export?…` | VIEWER | 200 `text/csv`; costly |
| `getAccountBalanceHistoryReport` | `GET W/reports/accounts/{accountId}/balance-history?from&to&reportingCurrency` | VIEWER | 200 `AccountBalanceHistoryReport` |
| `exportAccountBalanceHistoryReport` | `GET W/reports/accounts/{accountId}/balance-history/export?…` | VIEWER | 200 `text/csv`; costly |
| `getNetWorthReport` | `GET W/reports/net-worth?from&to&grouping&granularity&reportingCurrency` (`x-openspec-capability: reporting/net-worth`) | VIEWER | 200 `NetWorthReport` |
| `exportNetWorthReport` | `GET W/reports/net-worth/export?…` (`reporting/net-worth`) | VIEWER | 200 `text/csv`; costly |
| `getReportDrillDown` | `GET W/reports/drill-down?report&{celda}&{común}&limit&cursor` | VIEWER | 200 `ReportDrillDownPage` |
| `exportReportDrillDown` | `GET W/reports/drill-down/export?report&{celda}&{común}` | VIEWER | 200 `text/csv`; costly |

Todas responden también 304 (con `If-None-Match`), 400, 401, 403, 404 (cuenta del historial), 422 (`CURRENCY_NOT_ENABLED`, `REPORT_EXPORT_TOO_LARGE` en exportaciones), 429, 500, 503, y fijan `ETag` y `cache-control`.

**Parámetros comunes** (`components/parameters`, `{común}`): `ReportFrom`, `ReportTo` (`LocalDate`, requeridos), `ReportGrouping` (`FINANCIAL_PERIOD` | `CALENDAR_MONTH`, por omisión `FINANCIAL_PERIOD`), `ReportCompare` (`NONE` | `PREVIOUS_PERIOD` | `PREVIOUS_YEAR` | `CUSTOM` | `PREVIOUS_PERIOD_TO_DATE`, por omisión `NONE`), `ReportCompareFrom`, `ReportCompareTo` (`LocalDate`, solo con `CUSTOM`), `ReportNormalize` (`NONE` | `PER_DAY`), `ReportRolling` (`3` | `6` | `12`), `ReportingCurrency` (`CurrencyCode`, por omisión la base), `ReportConversion` (`HISTORICAL` | `CUTOFF`, por omisión `HISTORICAL`), `ReportAccountId[]`, `ReportCurrency[]`, `ReportCategoryId[]`, `ReportTagId[]`, `ReportCounterpartyId[]` (`style: form`, `explode: true`). Específicos: `granularity` (`PERIOD` | `WEEK`; patrimonio: `PERIOD` | `DAY`), `topN` (1..50), `limit` (1..200, 50), `cursor`.

**Esquemas** (`components/schemas`):
- `ReportId`: `type: string`, `x-extensible-enum` [`INCOME_EXPENSES`, `BUDGET_VS_ACTUAL`, `EXPENSES_BY_CATEGORY`, `EXPENSES_BY_TAG`, `EXPENSES_BY_ACCOUNT`, `MONTHLY_TRENDS`, `CASH_FLOW`, `NET_WORTH`, `SAVINGS_GOALS`, `DEBT_EVOLUTION`, `RECURRING_COSTS`, `SUBSCRIPTION_EVOLUTION`, `FX_CONVERSIONS`, `FEES`, `ACCOUNT_BALANCE_HISTORY`, `FORECAST_VS_ACTUAL`].
- `ReportCatalog`: `{reports[{reportId, number (1..16), status: AVAILABLE|PARTIAL|PLANNED (x-extensible-enum), phase, plannedIn: string|null, endpoint: string|null, viewPath: string|null}]}`.
- `ReportPeriod`: `{label, from, to, partial: boolean, days}`.
- `ReportAmount`: `{byCurrency: Money[], consolidated: Money, complete: boolean, unconverted: Money[]}`.
- `ReportVariation`: `{compared: ReportAmount, deltaAbs: Money, deltaPct: DecimalString|null, isNew: boolean}`; `ReportBaseline`: `{periods: 3|6|12, average: Money|null, periodsUsed: integer, insufficient: boolean, deltaAbs: Money|null, deltaPct: DecimalString|null}`.
- `ReportConversionMeta`: `{policy: TRANSACTION_DATE|VALUATION_DATE|CUTOFF_DATE, cutoffDate: LocalDate|null, rateWindowDays, ratesUsed: ResolvedRate[], attributions: string[]}`.
- `ReportMeta`: `{reportId, reportingCurrency, grouping, from, to, periods: ReportPeriod[], comparison: {mode, from, to, days, normalized}|null, conversion: ReportConversionMeta, complete, unconverted: Money[], dataVersion, latestEntryAt: date-time|null, generatedAt, filters: {accountIds[], currencies[], categoryIds[], tagIds[], counterpartyIds[]}}`.
- `IncomeExpensesReport`: `{meta, granularity, rows[{period: ReportPeriod, income, expenses, savings: ReportAmount, savingsRate: DecimalString|null, comparison: {income, expenses, savings: ReportVariation}|null, baseline: {income, expenses, savings: ReportBaseline}|null}], totals: {income, expenses, savings, savingsRate}}`.
- `ExpensesByCategoryReport`: `{meta, groups[{groupId, name, amount: ReportAmount, negativeNet, comparison: ReportVariation|null, categories[{categoryId, name, archived, amount, negativeNet, comparison, subcategories[…mismo nodo sin hijos]}]}], others: ReportAmount|null, total: ReportAmount}`.
- `BudgetVsActualReport`: `{meta, periods[{period: ReportPeriod, status: BUDGETED|NO_BUDGET, budgetId|null, currency|null, lines: BudgetLineProgress[], totals {planned, actual, remaining, availableToSpend: Money, complete, unconverted}|null, ratesUsed: ResolvedRate[]}]}` (reutiliza `BudgetLineProgress`).
- `CashFlowReport`: `{meta, periods[{period, byCurrency[{currency, opening, operating, debt, savingsInvestments, currencyExchange, adjustments, closing: Money}], consolidated {opening, operating, debt, savingsInvestments, currencyExchange, adjustments, revaluation, closing: Money, complete, unconverted}, comparison: {…ReportVariation por componente}|null}]}`.
- `AccountBalanceHistoryReport`: `{meta, accountId, currency, opening: Money, days[{date, balance: Money, valued: Money|null, hasMovements, reconciled}], closing: Money}`.
- `NetWorthReport`: `{meta, granularity, points[{date, netWorth: ReportAmount}], decomposition[{period: ReportPeriod, opening, closing, savings, conversionResult, adjustments, otherMovements, fxRevaluation, assetRevaluation: Money, revaluationByCurrency[{currency, kind, amount: Money}], complete, unvalued: Money[]}]}`.
- `ReportDrillDownPage`: `{meta, kind: PORTION|LIQUIDITY_MOVEMENT|ACCOUNT_MOVEMENT|NET_WORTH_ACCOUNT (x-extensible-enum), totals: ReportAmount, count, rows[{transactionId|null, splitId|null, journalEntryId|null, date, accountId|null, accountIds[]|null, categoryId|null, counterpartyId|null, description|null, nature|null, component|null, amount: Money, valued: Money|null, rate: ResolvedRate|null}], nextCursor: string|null}`.
- `ErrorCode`: se documenta `REPORT_EXPORT_TOO_LARGE` (el esquema es de conjunto abierto; se agrega a la descripción y a docs/10 §9.1).

**Contratos entre módulos** (TypeScript, aditivos):

```ts
// @pf/transactions/contracts
interface NominalFlowQuery {
  summarizeNominalFlows(input: {
    workspaceId: string; dateFrom: string; dateTo: string;
    categoryIds?: readonly string[]; withTags?: boolean;          // existentes
    accountIds?: readonly string[]; counterpartyIds?: readonly string[];
    tagIds?: readonly string[]; currencies?: readonly string[];     // nuevos (filtros)
    groupBy?: readonly ('ACCOUNT' | 'COUNTERPARTY')[];              // nuevo
  }): Promise<readonly NominalFlowRowDto[]>;                        // + accountId?, counterpartyId?: string | null
}
interface NominalPortionQuery {
  listPortions(input: {
    workspaceId: string; dateFrom: string; dateTo: string; nature?: 'INCOME' | 'EXPENSE';
    categoryIds?: readonly string[]; accountIds?: readonly string[]; counterpartyIds?: readonly string[];
    tagIds?: readonly string[]; currencies?: readonly string[]; limit: number; cursor?: string;
  }): Promise<{
    rows: readonly { transactionId: string; splitId: string; businessDate: string; nature: 'INCOME' | 'EXPENSE';
      categoryId: string; accountId: string; counterpartyId: string | null; description: string | null;
      amount: FlowMoneyDto }[];
    nextCursor: string | null; count: number; totals: readonly FlowMoneyDto[];
  }>;
}
// @pf/ledger/contracts
type FlowCounterpartClassDto = 'INCOME' | 'EXPENSE' | 'FX_TRADING' | 'OPENING_BALANCE' | 'ADJUSTMENTS'
  | 'OUTSIDE_ASSET' | 'OUTSIDE_LIABILITY';
interface AccountSetFlowQuery {
  summarize(input: { workspaceId: string; accountIds: readonly string[]; dateFrom: string; dateTo: string }):
    Promise<readonly { businessDate: string; currency: string; counterpart: FlowCounterpartClassDto; amount: string }[]>;
  listMovements(input: { workspaceId: string; accountIds: readonly string[]; dateFrom: string; dateTo: string;
    counterparts?: readonly FlowCounterpartClassDto[]; limit: number; cursor?: string }): Promise<{
    rows: readonly { journalEntryId: string; transactionId: string | null; businessDate: string;
      accountIds: readonly string[]; currency: string; counterpart: FlowCounterpartClassDto; amount: string }[];
    nextCursor: string | null; count: number; totals: readonly MoneyDto[];
  }>;
}
```

Todas sin efectos, en la unidad de trabajo del llamador (RLS del workspace), sin consultas en paralelo sobre el mismo cliente.

**Eventos:** ninguno nuevo ni consumido. Auditoría (Should): acción `reporting.report.exported` en el log de auditoría (no es un evento de dominio).

## Riesgos / Trade-offs

- [RISK-029, rendimiento sin read models] → consultas agregadas en SQL, una resolución de tasas por petición, filas bloqueantes en el nightly, métrica y alerta que recomiendan un read model por reporte (decisión 2). Si una fila falla, el primer recurso es colapsar en SQL los flujos en la moneda de reporte por periodo (no necesitan tasa por día) antes de proponer una proyección.
- [Comparaciones que triplican la lectura (YoY + móvil 12 = 36 meses)] → fila bloqueante propia; si no cumple, pregunta 9.
- [Presupuesto vs real con 12 llamadas a PLANNING] → secuenciales en la misma unidad de trabajo; si la fila falla, se propone a PLANNING (change aparte) un `getForPeriods` por lote.
- [Diferencia entre el ahorro del reporte 1 y el de la descomposición del patrimonio con cuentas excluidas] → se explica en la UI y en `docs/14`; la reconciliación compara cada uno con su identidad.
- [Exportaciones grandes en el proceso de la API] → tope de 50 000 filas, streaming, cuota `costly`.
- [Cambio de `NominalFlowQuery` usado por el Home y PLANNING] → solo campos opcionales; TC de regresión del Home y del presupuesto.
- [Consulta `AccountSetFlowQuery` con conjuntos grandes] → el conjunto es de cuentas del usuario (≤ 100 por workspace); índice existente `ledger.posting (workspace_id, ledger_account_id, entry_date)`; `EXPLAIN` en la tarea 5.3.

## Plan de migración

1. Contratos aditivos en TRANSACTIONS y LEDGER con sus tests (sin migraciones).
2. Si el `EXPLAIN` del drill-down lo pide: migración expand-only con `CREATE INDEX CONCURRENTLY` (sin transacción, archivo propio), timestamp posterior a la última de `main`. Sin tablas nuevas, sin RLS nueva, sin registro en `platform.workspace_scoped_table`.
3. Endpoints, UI y filas del nightly. Rollback: retirar las rutas (lecturas sin estado); el índice, si existe, queda inerte.

## Preguntas abiertas

1. **[B] Read models de FR-REPORTING-007.** (a) **Lectura por conjunto sin read models ni consumidores, con métrica y alerta que recomiendan un read model por reporte** (este diseño; docs/01 FR-REPORTING-007 se anota como "condicionado a la métrica"); (b) proyecciones `monthly_category_agg`/`monthly_account_agg`/`daily_balance` con un consumidor nuevo (+1 conexión: 57 de 70, 65 de 67 útiles, un consumidor más en la ráfaga del import); (c) caché de periodos cerrados escrita en la lectura. **Recomendación: (a).** Bloquea el grupo 5 (infraestructura).
2. **Partición en dos changes.** (a) **Núcleo Must aquí y reportes Should, vistas guardadas y PDF en `add-financial-reports-extended`**; (b) un único change; (c) tres changes. **Recomendación: (a).** Bloquea solo el orden (este change va primero).
3. **Agrupación por omisión.** (a) **Periodo financiero** (como el costo de conversiones, D246); (b) mes calendario (como el Home). Cierra docs/14 pregunta 2. **Recomendación: (a)**, con el Home enlazando en mes calendario. No bloquea.
4. **USDT en la descomposición del patrimonio.** No hay atributo de "estable" en las monedas. (a) **Agrupar por tipo de moneda (`FIAT` cambiaria; las demás, incluido USDT, de activos) y mostrar siempre la revalorización por moneda**; (b) tratar USDT como cambiaria con una lista configurable de monedas atadas al dólar (`REPORTING_PEGGED_CURRENCIES`). **Recomendación: (a)**: la línea "USDT" responde "¿subió porque ahorré o porque subió el USDT?" sin configuración nueva. No bloquea.
5. **Auditoría de las exportaciones de reportes.** (a) **Auditarlas** (docs/14 §12: exportar datos financieros es sensible; como el recorrido, FR-AUDIT-013); (b) no auditarlas (precedente del costo de conversiones). **Recomendación: (a).** No bloquea (requirement Should).
6. **Separador del CSV.** (a) **Coma y punto decimal, igual que las exportaciones actuales**; (b) por locale (`;` y coma decimal en es-BO), como sugiere docs/14 §12. **Recomendación: (a)** ahora; (b) como change propio para todas las exportaciones a la vez. No bloquea.
7. **D55: endpoint `kpis` y destino de `summary`.** (a) **No crear `kpis`: `summary` sigue siendo el endpoint del Home, sin `Sunset`**; (b) `kpis` como alias; (c) deprecar `summary`. **Recomendación: (a)**; `add-cash-flow-forecast` también lo da por resuelto aquí (su tabla de dependencias). No bloquea.
8. **Gráficos.** (a) **Componentes SVG propios** (patrón de `NetWorthEvolutionChart`, sin dependencia nueva ni impacto en el bundle del Home); (b) ECharts cargado solo en `/reportes` (convención de docs/14 y docs/28). **Recomendación: (a)** para este change; revisar en el change hermano (treemap y heatmap). No bloquea.
9. **Fila del nightly con YoY y promedio móvil de 12.** (a) **Bloqueante desde el inicio** (FR-REPORTING-009 aplica a todos los reportes temporales); (b) informativa hasta dos nightlies en verde. **Recomendación: (a).** No bloquea la spec.
10. **Exportaciones grandes.** (a) **Síncronas con tope de 50 000 filas y `REPORT_EXPORT_TOO_LARGE`**; (b) job asíncrono con archivo y notificación (docs/14 §12; agregaría un consumidor). **Recomendación: (a).** No bloquea.

## Dependencias con otros changes de Phase 7

- **`add-cash-flow-forecast` (en paralelo):** dueño de `reporting/cash-flow-calendar`, NFR-PERF-010 (su fila del nightly y la entrada `PERF_THRESHOLDS['NFR-PERF-010']`), Q8 completo, las alertas de déficit (D218) y la variación por categoría de Q7 en el resumen del Home (su pregunta 13). El reporte 7 de este change es el flujo histórico; su parte futura enlaza al calendario. El requirement de `reporting/dashboard` de este change solo agrega el enlace de Q7 al reporte (nombre distinto, sin solape). Coordinar la edición de `perf-report.ts` (ambos agregan entradas a `PERF_THRESHOLDS`) y el orden de archivado si los dos deltas de `reporting/dashboard` se archivan el mismo día.
- **`add-historical-budgets` (en paralelo):** consume `NominalFlowQuery` sin cambiarla y declara que `BudgetVsActualQuery` no cambia; este change solo consume `BudgetVsActualQuery.getForPeriod` y `PeriodQuery.listPeriods`. Los filtros y `groupBy` que este change agrega a `summarizeNominalFlows` son opcionales y no alteran su agrupación por omisión.
- **`add-rule-suggestions` (en paralelo):** sin relación con este change.
- **`add-financial-reports-extended`:** depende de este (contratos, esquemas, drill-down, CSV, UI); va después.

## Cambios a docs compartidos

- `docs/01-functional-requirements.md`: nota en FR-REPORTING-007 (read models condicionados a la métrica, pregunta 1); nota en FR-REPORTING-008 con el estado por reporte y la partición en dos changes; FR-REPORTING-009/010/011/012 con el as-built.
- `docs/02-non-functional-requirements.md`: NFR-PERF-006, medición con las filas `report-*` del nightly y el rango fijo del Large Seed.
- `docs/03-openspec-strategy.md` §7: agregar `add-financial-reports` y `add-financial-reports-extended` al orden de Phase 7 (este antes que el hermano).
- `docs/10-api-design.md`: §13.6 con los endpoints `W/reports/*` nuevos y sus parámetros comunes; §9.1 con `REPORT_EXPORT_TOO_LARGE`; fila de `reports` de la tabla de recursos.
- `docs/14-reporting.md`: as-built en §2.1/§2.2 (sin read models, lectura por conjunto), §5 (política declarada en `meta.conversion`, `CUTOFF`), §6 (YoY de periodos financieros, móvil sin periodos previos al primer asiento), §7 (estado por reporte), §8 (flujo histórico por contrapartida), §4.1 (descomposición exacta), §10, §11 (filas del nightly) y §12 (CSV, tope); cerrar preguntas 2, 7 y 8 según las respuestas.
- `docs/16-testing-strategy.md`: la reconciliación reporte↔ledger en tres niveles.
- `docs/23-ci-cd.md` §5.5: filas `report-*` (bloqueantes e informativas) del nightly.
- `docs/28-ui-ux-design-system.md`: sección "Reportes" (barra de filtros, panel de drill-down, bloque de conversión).
- `docs/38-estado-y-pendientes.md`: estado del change y preguntas abiertas.
