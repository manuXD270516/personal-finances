# Propuesta: add-debt-summary

## Why

Phase 4 (docs/24 §5.4) quiere que el owner "controle préstamos y tarjetas"; con `add-loans` y `add-credit-cards` cada deuda tiene su detalle, pero nada responde de un vistazo **"¿cuánto debo y cuándo termino?"**: hoy el patrimonio neto resta los pasivos sin separarlos, el interés pagado está mezclado con el resto de gastos y las fechas de fin y vencimientos viven en pantallas distintas. FR-DEBT-018 (docs/01 §11, Could) pide un resumen de deudas con el total adeudado por moneda y en moneda base, el interés pagado en el año y la fecha estimada libre de deudas; docs/00 §2 lista "salir de deudas" entre los objetivos del owner y docs/14 §10 reserva el widget `DebtSummary` para el Home. Este change arma ese resumen sobre lo que exponen los préstamos, las tarjetas y el ledger, sin estado propio.

## What Changes

- **Resumen de deudas** (query `GetDebtSummary` del contexto DEBT, `@pf/debt`, sin tablas nuevas): cada cuenta de pasivo no archivada con saldo adeudado, agrupada en préstamos (`add-loans`), tarjetas por moneda (`add-credit-cards`) y otros pasivos (`manual_liability` y cuentas `loan`/`credit_card` sin perfil en Debt); total por moneda y consolidado en la moneda base con `FlowValuation` (docs/33 D109) y la tasa de hoy, sin 1:1; saldos a favor aparte.
- **Interés pagado en el año** (1 de enero a hoy en la zona del workspace): gastos de la categoría de sistema `INTEREST` netos de reembolsos (`NominalFlowQuery`), por moneda y consolidado con la tasa de cada fecha (`conv_t`), desglosado por préstamo (imputaciones de `add-loans`), por tarjeta (`AccountMovementsQuery` de `add-credit-cards`) y "otros intereses".
- **Fecha estimada libre de deudas**: la mayor de las fechas de fin estimadas (préstamo: última cuota no pagada del cronograma vigente; tarjeta: último vencimiento con cuotas o el del estado de cuenta que factura el saldo, pagando el total y sin compras nuevas); otros pasivos "no estimables", informados aparte.
- **Próximos vencimientos**: el siguiente de cada deuda (cuota de préstamo con atraso; estado de cuenta emitido con lo que falta y el mínimo, o el ciclo abierto estimado).
- **Home**: tarjeta "Deudas" (total, interés del año, fecha libre de deudas, próximo vencimiento, enlace) con estados vacío y "sin deudas pendientes" sin ceros inventados (`reporting/dashboard`, FR-REPORTING-001). **Vista** `/debts` pestaña Resumen.
- **API** `GET W/debts/summary` (VIEWER).
- **Fuera de alcance:** payoff simulator y estrategias avalanche/snowball (FR-DEBT-010, `add-loan-amortization-advanced`); reporte "Debt Evolution" y DTI (Phase 7, docs/14); proyección del interés futuro; metas de salida de deudas; notificaciones nuevas; cualquier escritura (el resumen es solo lectura).

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `debt/loans`: resumen de deudas (FR-DEBT-018 está asignado a esta capability en docs/01 §11): total adeudado por moneda y en base, interés pagado en el año, fecha estimada libre de deudas, próximos vencimientos y permisos (5 requirements ADDED: 1 Must, 4 Could). La capability la crea `add-loans` (en diseño en paralelo).
- `reporting/dashboard`: tarjeta "Deudas" en el Home (1 requirement ADDED: Could).

## Impact

**Specs impactadas:** agrega requirements a `debt/loans` (creada por `add-loans`) y a `reporting/dashboard`. Lee `debt/credit-cards` (`add-credit-cards`), `debt/amortization` (cronograma vigente, `add-loans`), `ledger/balances`, `accounts/account-management` (cuentas de pasivo), `transactions/transaction-recording` (gastos de interés), `classification/categories` (categoría de sistema `INTEREST`), `fx/market-rates` (valoración), `security/access-control`.

**Componentes/contextos impactados:** DEBT (`@pf/debt`): DS puros `DebtSummaryCalculator` (agrupación, totales, saldo a favor), `DebtFreeDateEstimator`, `InterestAttribution`; query `GetDebtSummary` en application; controller `debts` en `apps/api`; `apps/web` (tarjeta del Home y `/debts` Resumen). Sin cambios de dominio en otros contextos: consume `LoanPortfolioQuery` (ampliada, de `add-loans`), `CardPortfolioQuery` (de `add-credit-cards`), `AccountCatalogQuery`, `AccountBalancesQuery`, `NominalFlowQuery`, `AccountMovementsQuery`, `CategoryCatalogQuery` (categoría con `systemCode = INTEREST`), `FxValuationPort`, `WorkspaceCalendarQuery`.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `GET W/debts/summary` (`getDebtSummary`, tag `debts`, `x-openspec-capability: debt/loans`), schema `DebtSummary`. Sin códigos de error nuevos. Aditivo.

**Tablas impactadas:** ninguna (lectura de `accounts.account`, `ledger.*` vía queries, `txn.*` vía queries, `debt.*` de `add-loans` y `add-credit-cards`).

**Eventos impactados:** ninguno (ni produce ni consume).

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-DEBT-SUMMARY-001..010 (10). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** ninguno sobre comportamientos existentes; el Home suma una tarjeta y una llamada (vigilar NFR-PERF del Home con el seed `large`). El total adeudado debe coincidir con los pasivos del patrimonio neto cuando todos los pasivos se incluyen en él (test de consistencia contra `reporting/net-worth`).

**Riesgos introducidos:** RISK-017 (consolidación multi-moneda; nunca 1:1), RISK-020 (año y "hoy" en la zona del workspace), RISK-029 (rendimiento del Home: una consulta más con varias lecturas).

**Invariantes afectadas:** INV-001/002 (Decimal con moneda; nunca se suman monedas distintas), INV-012 (el interés de cada fecha se valora con la tasa de esa fecha), INV-022 (saldos del ledger), INV-025 (aislamiento), INV-031 (identidad de valoración: total adeudado coherente con el patrimonio). Sin escrituras.
