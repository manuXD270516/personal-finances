# Diseño

## Contexto

El contexto REPORTING (supporting, schema `reporting`, `@pf/reporting`) es de solo lectura (CQRS, docs/14 §1–§2): nunca es fuente de verdad ni escribe en otros schemas. docs/14 §2.2 establece que en Phase 1 los saldos e ingresos/gastos del mes actual se leen **directo de la fuente de verdad** (ledger + splits) por *read-your-writes*; las proyecciones materializadas llegan cuando una métrica de latencia lo justifique (Phase 7). Fórmulas: docs/14 §4 (Income, Expenses, Savings, Savings rate, Net worth, Liquid balance), §5 (multi-moneda: `conv_t` para flujos, `conv_v` para stocks, tasa faltante, redondeo al presentar) y §6 (comparación "a la fecha"). Preguntas del Home: docs/00 §6. Endpoint: docs/10 §14 (`GET W/reports/summary`, P1). Motivación: ver proposal.md — Why.

Contextos, agregados y puertos:

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Reporting | DS puros `KpiCalculator` (income, expenses, savings, savingsRate, topCategories), `NetWorthValuator`, `PeriodComparator`, `ConsolidationService` (agrega por moneda/día y convierte una vez) | domain | Nuevo |
| Reporting | `GetReportSummary` (query use case), consumidor `DataVersionProjector` | application | Nuevo |
| Reporting | Puertos `BalanceQuery` (→ `@pf/ledger/contracts`), `NominalFlowQuery` (→ `@pf/transactions/contracts`), `AccountCatalog` (→ `@pf/accounts/contracts`), `CategoryCatalog` (→ `@pf/classification/contracts`), `RateResolver` (→ `@pf/fx/contracts`), `Clock`, `DataVersionStore` | application/infrastructure | Nuevos adapters |
| Ledger | Query `GetBalances(accountIds, asOf)` por lote | application (contracts) | Se consume (definida en `add-ledger-core`) |
| Transactions | Query pública `SummarizeNominalFlows(range, statuses)` → filas `{businessDate, currency, nature: INCOME|EXPENSE, categoryId, amount}` agregadas por día, de postings a `INCOME:*`/`EXPENSE:*` de asientos activos (solo `posted|cleared|reconciled`) | application (contracts) | **Nueva query requerida** en Transactions |
| FX | `GetRate(pair, at, policy)`, `ConvertForValuation(money, target, at)` → `ResolvedRate` con `provider`, `selection`, `stale`, `ageSeconds`, `attribution` | contracts | Se consume (de `add-manual-conversions`, ampliado por `add-market-rate-providers`) |

## Objetivos / No objetivos

**Objetivos:**
- `GET /reports/summary` con KPIs de Q1, Q2, Q3, Q6, Q7 básico y patrimonio neto actual, por moneda y consolidado en la moneda de reporte del workspace (BOB).
- Cálculos puros y deterministas testeables con fixtures pequeños (TDD) y PBT.
- p95 ≤ 300 ms del endpoint con seed `large` (NFR-PERF-004).

**No objetivos:**
- Read models materializados, rebuild de proyecciones y verificador de drift (Phase 7).
- `DashboardLayout` configurable y `GET /reports/dashboard`.
- Caché Redis (opcional; Phase 1 usa ETag por `dataVersion`).

## Decisiones

1. **Fuente de verdad directa en Phase 1.** Saldos: `GetBalances(accountIds, asOf = hoy en TZ del workspace)` (Σ postings, acelerado por `ledger.balance_snapshot`). Flujos: `SummarizeNominalFlows` de Transactions (postings a INCOME/EXPENSE de asientos activos unidos a la categoría del split). Por construcción quedan fuera transferencias, conversiones (salvo sus fees), saldos iniciales y ajustes no categorizados (docs/14 §4.3) y las transacciones `pending`/`void` (INV-023). Alternativa — proyección `txn_fact` alimentada por eventos — descartada para Phase 1: añade consistencia eventual visible (RISK-022) sin necesidad de latencia; queda para Phase 7. La descripción actual del contrato ("Served from derived read models") se corrige (§Contratos).
2. **Fórmulas** (docs/14 §4): `Income(P) = −Σ INCOME`; `Expenses(P) = Σ EXPENSE` (refunds restan en la fecha del refund); `Savings = Income − Expenses`; `SR = Savings / Income` si `Income > 0`, si no `null` (UI "—"), con 1 decimal HALF_EVEN; `NW = Σ conv_v(balance ASSET) − Σ conv_v(deuda LIABILITY)` sobre cuentas `includeInNetWorth`; `LiquidBalance = Σ conv_v(balance)` de cuentas ASSET con `includeInLiquidity` (FR-ACCOUNTS-011).
3. **Conversión** vía `RateResolver` de FX: stocks con `conv_v(hoy)`; flujos con `conv_t` aplicada **por agregado diario por moneda** (Σ por día × tasa vigente al cierre de ese día en la TZ del workspace), ventana de 7 días, tipo preferido del par. Para USD/BOB y USDT/BOB la preferencia sembrada al crear el workspace es `PARALLEL` y la selección es la de `fx/market-rate-providers` (docs/31 D29, ADR-0025): provider principal no obsoleto → respaldo → la más reciente entre la última de provider (marcada `stale` con su antigüedad) y la última manual → `unconverted`. Los meses pasados usan el histórico diario cargado del provider. Cada tasa usada viaja en `meta.ratesUsed` y su atribución en `meta.attributions`; la UI muestra "Fuente: paralelo.bo" (CC BY 4.0) junto a la tasa; en valoración se admite la tasa cruzada por pivote (FR-FX-005, Should) marcada `approx`. Sin tasa → el monto va a `unconverted`, el consolidado lleva `complete = false`. Agregados internos en `Decimal` precisión 40 sin redondear; HALF_EVEN a la escala de la moneda de reporte **solo al serializar** (docs/14 §5, NFR-DATA-002).
4. **Periodo** = mes calendario por `business_date` en la TZ del workspace (`America/La_Paz`); `month=YYYY-MM` o `dateFrom/dateTo`. Comparación por defecto `PREVIOUS_PERIOD_TO_DATE`: si el periodo contiene "hoy", compara días 1..N contra 1..N del mes anterior (acotando N al último día del mes anterior); si es un mes cerrado, compara meses completos. `Δ% = (cur − prev)/|prev| × 100` si `prev ≠ 0`, si no `isNew = true`.
5. **Top-N**: categorías de gasto ordenadas por monto neto consolidado descendente, desempate por nombre (collation `es`), `topCategories` 0..20, default 5; incluye la categoría de sistema *Fees*; montos netos negativos se muestran tal cual.
6. **Disponibilidad de preguntas** (FR-REPORTING-001): la respuesta incluye `questions[]` con `Q1..Q9` y `status ∈ {AVAILABLE, NO_DATA, NOT_AVAILABLE_IN_PHASE}` + `actionHint`; la UI nunca rellena con 0.
7. **Frescura / caché.** `meta.generatedAt` (Clock), `meta.dataFreshness` = instante del último asiento leído. Un consumidor idempotente (`platform.inbox`) incrementa `reporting.workspace_data_version` ante los eventos listados en la propuesta; el ETag de la respuesta = hash(`dataVersion`, params). Como la lectura es directa, la respuesta tras un POST del usuario siempre refleja su escritura aunque el consumidor esté atrasado (el ETag solo se usa con `If-None-Match`, y el BFF invalida TanStack Query tras cada comando).
8. **Autorización/RLS**: VIEWER puede leer; todas las queries corren con `SET LOCAL app.workspace_id` (INV-025, ADR-0023).

Modelo de datos (expand-only):

| Tabla | Cambio | RLS / grants |
|---|---|---|
| `reporting.workspace_data_version` | Crear: `workspace_id uuid PK`, `version bigint NOT NULL DEFAULT 0`, `updated_at timestamptz` | WS; política **DRV**: `pf_worker` INSERT/UPDATE, `pf_app` SELECT; sin audit (derivada) |
| `ledger.posting` | Índice `(workspace_id, ledger_account_id, entry_date) INCLUDE (amount)` si no existe | Sin cambio de RLS |

## Contratos

Cambios **exactos** requeridos (los consolida otro proceso; este change no edita `contracts/`).

**`contracts/openapi/finance-api.v1.yaml`**

Operación `getReportSummary` (`GET /workspaces/{workspaceId}/reports/summary`) — modificar:
- `description`: reemplazar "Served from derived read models (eventually consistent…)" por: calculado desde la fuente de verdad (ledger + transacciones posteadas) en Phase 1; consolidado siempre presente con `complete=false` y `unconverted[]` cuando falta alguna tasa; stocks valorados a la fecha de consulta y flujos a la tasa de su fecha.
- `x-openspec-capability`: `[reporting/dashboard, reporting/net-worth]`.
- Parámetro nuevo `compare`: enum `[PREVIOUS_PERIOD_TO_DATE, PREVIOUS_PERIOD, NONE]`, default `PREVIOUS_PERIOD_TO_DATE`.
- `topCategories`: sin cambio (0..20, default 5).
- Respuesta 200: agregar header `ETag`; agregar respuesta `304` (`NotModified`) con `If-None-Match` (parámetro `IfNoneMatch`); agregar `422` (`UnprocessableEntity`) para `CURRENCY_NOT_ENABLED` en `reportingCurrency`.

Schemas nuevos:
- `MoneyVariation`: required `[current, previous, deltaAbs, isNew]`; `current`, `previous`, `deltaAbs` (Money), `deltaPct` (DecimalString|null, en %, 2 decimales), `isNew` (bool).
- `PeriodComparison`: required `[mode, previousPeriod, income, expense, savings]`; `mode` (enum anterior sin `NONE`), `previousPeriod` `{from, to}` (LocalDate), `income`, `expense`, `savings` (`MoneyVariation`).
- `ConsolidatedTotals`: required `[currency, income, expense, net, liquidBalance, assets, liabilities, netWorth, complete, unconverted]`; los Money anteriores en la moneda de reporte, `savingsRate` (DecimalString|null, 1 decimal, null = no definida), `complete` (bool), `unconverted` (Money[]: montos por moneda excluidos por falta de tasa).
- `AccountBalanceLine`: required `[accountId, name, type, nature, balance, includeInNetWorth, liquid]`; `type` (`AccountType`), `nature` enum `[ASSET, LIABILITY]`, `balance` (Money nativa), `convertedBalance` (Money|null), `rate` (`ResolvedRate`|null), `includeInNetWorth`, `liquid` (bool).
- `NetWorthBreakdown`: required `[assets, liabilities, netWorth, complete, byCurrency, byAccountType, unvalued]`; `byCurrency[]` `{currency, assets, liabilities, net (Money nativa), converted (Money|null)}`; `byAccountType[]` `{type: AccountType, amount: Money (moneda de reporte, pasivos negativos)}`; `unvalued` (Money[]).
- `HomeQuestionStatus`: `{question: enum [Q1..Q9], status: enum [AVAILABLE, NO_DATA, NOT_AVAILABLE_IN_PHASE], actionHint: string|null}`.

Schema `ReportSummary` — modificar:
- `required`: `[period, byCurrency, consolidated, accounts, topExpenseCategories, netWorth, questions, meta]`.
- `consolidated`: de `oneOf [CurrencyTotals, null]` a `ConsolidatedTotals` (siempre presente).
- `accounts.items`: de objeto inline a `AccountBalanceLine`.
- `topExpenseCategories.items`: agregar `complete` (bool); `amount` documentado como neto en moneda de reporte (puede ser negativo).
- Agregar `comparison` (`PeriodComparison`|null; null si `compare=NONE`), `netWorth` (`NetWorthBreakdown`), `questions` (`HomeQuestionStatus[]`).
- `meta`: `ratesUsed.items` de `ReferenceRate` a `ResolvedRate` (definido por `add-manual-conversions`: incluye `rateType`, `asOf`, `ageDays`, `derivation`; `add-market-rate-providers` agrega `provider`, `selection`, `stale`, `ageSeconds`, `attribution`); agregar `attributions` (`RateAttribution[]`, sin duplicados, definido por `add-market-rate-providers`); agregar `timeZone` (string IANA), `rateWindowDays` (integer), `complete` (bool); `approx` documentado como "true si algún consolidado usa tasas de referencia o cruzadas".
- `CurrencyTotals`: agregar `liquidBalance` (Money) y `savingsRate` (DecimalString|null); `net` documentado como ahorro (ingresos − gastos).

**`contracts/events/`**: sin cambios (solo consume eventos existentes y `fx.RateRecorded.v1` definido por `add-manual-conversions`).

> Consolidado en contracts/ el 2026-10-02.

## Riesgos / Trade-offs

- [Lectura directa más lenta con historia larga] → snapshots de saldo + índice cubriente; benchmark con seed `large` en CI nightly; umbral para introducir `txn_fact` en Phase 7 (RISK-029).
- [Query cruzada Transactions↔Ledger para flujos] → encapsulada en la query pública `SummarizeNominalFlows` de Transactions (dueño de splits y del vínculo con asientos), sin joins cross-schema desde Reporting.
- [Tasa faltante oculta errores de lectura] → consolidado `complete=false` + `unconverted` + `questions` evitan números silenciosamente incompletos (RISK-017).
- [Provider de tasa paralela caído o con datos anómalos] → el consolidado nunca desaparece: respaldo, última tasa conocida marcada obsoleta con antigüedad o tasa manual; anomalías retenidas hasta confirmación (RISK-023, `fx/market-rate-providers`).
- [Comparación "a la fecha" con meses de distinta longitud] → N se acota al último día del mes anterior (31-sep→30-ago); documentado en tooltip.

## Plan de migración

Expand-only: `CREATE SCHEMA IF NOT EXISTS reporting`, `CREATE TABLE reporting.workspace_data_version`, grants y política RLS, índice de lectura sobre `ledger.posting` con `CREATE INDEX CONCURRENTLY` si no existe. Sin datos que migrar (derivada; se inicializa en 0 y se recalcula sola). Rollback: revertir el despliegue; la tabla puede quedar.

Dependencias con otros changes de Phase 1: `add-workspace-identity` (moneda de reporte, TZ, roles), `add-accounts-management` (tipo, naturaleza, `includeInNetWorth`, `includeInLiquidity`), `add-ledger-core` (`GetBalances` as-of, snapshots), `add-classification` (nombres de categorías, *Fees*), `add-transaction-recording` (estados, refunds, `SummarizeNominalFlows`), `add-transfers` (pagos de tarjeta como transferencia), `add-manual-conversions` (`RateResolver`, `ResolvedRate`, preferencias de tipo, `fx.RateRecorded.v1`), `add-market-rate-providers` (tasa `PARALLEL` de provider, fallback, histórico diario, atribución), `add-api-conventions` (problem+json, ETag/304).

## Preguntas abiertas

- **Q1 "dinero disponible"**: docs/00 §6 lo define sobre cuentas líquidas; FR-ACCOUNTS-011 usa el flag `includeInLiquidity` mientras ARCHITECTURE §4.1 usa el atributo `liquidity` (`LIQUID|SEMI_LIQUID|ILLIQUID`). Se usa "cuenta líquida" = `includeInLiquidity` (o `liquidity = LIQUID`); alinear docs.
- **Lista de preguntas del Home**: docs/14 §9.1 propone otra numeración/redacción (Q2 = safe to spend, Q6 = top categorías…) distinta de docs/00 §6. Este change sigue docs/00 §6 (canónica para el dashboard).
- ~~**Tasa para USD/USDT↔BOB**~~: resuelta por el owner el 2026-10-02 (docs/31 D29, ADR-0025): tasa `PARALLEL` del provider (paralelo.bo, respaldo bo.dolarapi.com) con fallback a la última tasa conocida o manual. El promedio de conversiones propias queda descartado como default.
- **Ubicación de FR-REPORTING-004** (`reporting/financial-reports` en docs/01) vs su uso en el Home: ¿mover la parte del Home a `reporting/dashboard` en docs/01?
- `/reports/summary` vs `/reports/kpis` en Phase 7 (docs/10 pregunta abierta 2).
