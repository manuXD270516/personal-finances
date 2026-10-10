# Diseño

## Contexto

FR-DEBT-018 (docs/01 §11, Could, capability `debt/loans`) pide un resumen de deudas: total adeudado por moneda y en moneda base, interés pagado en el año y fecha estimada libre de deudas. El owner lo formula como "¿cuánto debo y cuándo termino?". Las piezas existen o las crean dos changes de Phase 4 diseñados en paralelo en el mismo contexto `@pf/debt`: `add-loans` (AR `Loan`, cronograma versionado, imputación de pagos con interés, `LoanPortfolioQuery`) y `add-credit-cards` (AR `CreditCard`, estados de cuenta, cuotas, `CardPortfolioQuery`, `AccountMovementsQuery` de Transactions). Los saldos vienen del ledger (`AccountBalancesQuery`), los pasivos sin perfil en Debt de Accounts (`AccountCatalogQuery`), el interés total de Transactions (`NominalFlowQuery`, que ya excluye el principal de transferencias y pagos, docs/14 §4.3) y la valoración del shared-kernel (`FlowValuation`, docs/33 D109). Este change **solo lee y compone**: no tiene tablas, eventos ni escrituras. Motivación: proposal.md — Why.

Reglas que se respetan: dinero `Decimal` con moneda, nunca se suman monedas distintas (INV-001/002); saldos derivados del ledger (INV-022); consolidación sin 1:1 y con la ventana de validez de Reporting (D29/D34/D53); flujos valorados con la tasa de su fecha (`conv_t`) y stocks con la de hoy (`conv_v`, docs/14 §5); "hoy" y el año en la zona del workspace (RISK-020); contextos sin imports cruzados (puertos `contracts`); RLS por workspace (INV-025); preguntas del Home sin datos inventados (FR-REPORTING-001, requirement "Preguntas del Home sin datos o no disponibles").

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Debt | DS puros `DebtSummaryCalculator` (agrupación por deuda, totales por moneda, saldo a favor aparte, orden), `DebtFreeDateEstimator` (fin por deuda y global con excluidas), `InterestAttribution` (desglose préstamo/tarjeta/otros que suma el total), `UpcomingDebtDues` (próximo vencimiento por deuda) | domain | Nuevo |
| Debt | Query `GetDebtSummary({workspaceId, asOf = hoy})` | application | Nuevo |
| Debt | Puertos internos del contexto: `LoanPortfolioQuery` (de `add-loans`, **ampliada**), `CardPortfolioQuery` (de `add-credit-cards`) | application | Consumo |
| Debt | Puertos externos: `AccountCatalogQuery` (→ `@pf/accounts/contracts`), `AccountBalancesQuery` (→ `@pf/ledger/contracts`), `NominalFlowQuery` y `AccountMovementsQuery` (→ `@pf/transactions/contracts`), `CategoryCatalogQuery` (→ `@pf/classification/contracts`), `FxValuationPort` (→ `@pf/fx/contracts`), `WorkspaceCalendarQuery` + moneda base (→ `@pf/identity/contracts`), `Clock` | application/infrastructure | Adapters (existentes o de los otros dos changes) |
| apps/api | Controller `debts` (`GET W/debts/summary`) | interface | Nuevo |
| apps/web | Tarjeta "Deudas" del Home y pestaña Resumen de `/debts` | interface | Nuevo |

## Objetivos / No objetivos

**Objetivos:**
- Una cifra de deuda total honesta (por moneda y en BOB, sin tasas inventadas) coherente con el patrimonio neto.
- Interés pagado del año atribuido a cada deuda, sumando exactamente el total.
- Una fecha "libre de deudas" explicable (qué supone y qué deudas no pudo estimar).
- Próximos vencimientos de todas las deudas en un solo lugar y una tarjeta del Home sin ceros inventados.

**No objetivos:**
- Payoff simulator, avalanche/snowball (FR-DEBT-010), Debt Evolution, DTI (docs/14, Phase 7).
- Proyectar interés futuro o simular pagos extra.
- Persistir el resumen, snapshots históricos o read models (`reporting.debt_snapshot` es de Phase 7).
- Notificaciones.

## Decisiones

1. **Universo de deudas = cuentas de pasivo, no perfiles de Debt.** Se parte de `AccountCatalogQuery.listAccounts({includeArchived: false})` filtrado a `nature = LIABILITY` (préstamos `loan`, tarjetas `credit_card`, `manual_liability`), con saldo **presentado** a hoy de `AccountBalancesQuery.getAccountBalances({accountIds})` (una sola llamada). Cada cuenta se asigna a: el préstamo cuyo `accountId` coincide (`LoanPortfolioQuery`), la tarjeta que la contiene (`CardPortfolioQuery`; una tarjeta bimoneda es **una** deuda con un saldo por moneda) o "otros pasivos" (incluye cuentas `loan`/`credit_card` aún sin perfil en Debt). Así el total coincide con lo que el ledger dice que se debe aunque no todo esté modelado en Debt, y con los pasivos del patrimonio neto (INV-031) cuando todos se incluyen en él. Cuentas con saldo 0 no se listan; saldo presentado < 0 ⇒ `creditBalances[]` (saldo a favor) y no resta del total (pregunta 2). Se incluyen los pasivos excluidos del patrimonio con la marca `includedInNetWorth: false` (pregunta 3).
2. **Total por moneda y consolidado.** `Σ` por moneda de los saldos positivos (Decimal, escala de la moneda). Consolidado: un `DatedAmount` por moneda fechado **hoy** (valor de stock, `conv_v(hoy)`, docs/14 §5) con `FlowValuation.resolveRates` + `consolidate`, `target` = moneda base del workspace, `windowDays = REPORTING_RATE_VALIDITY_WINDOW`; `complete = false` ⇒ `unconverted[]`; total HALF_EVEN solo al presentar. Usar `FlowValuation` (y no la valoración del patrimonio de `reporting/net-worth`) evita depender de Reporting (D109: kernel compartido) y produce la misma cifra porque ambas usan la tasa preferida del par y la misma ventana; el test de consistencia contra el patrimonio (TC-DEBT-SUMMARY-001) lo protege.
3. **Interés pagado en el año.** Rango `[1 de enero del año de hoy, hoy]` en la zona del workspace (año calendario; pregunta 4). Total: `NominalFlowQuery.summarizeNominalFlows({dateFrom, dateTo, categoryIds: [id de la categoría con systemCode = INTEREST]})` — gastos netos de reembolsos, solo asiento activo; la categoría de sistema no admite subcategorías. Consolidado con `FlowValuation` por (moneda, día) (`conv_t`, INV-012). **Atribución (`InterestAttribution`)**: préstamos = Σ interés imputado en el rango por préstamo (`LoanPortfolioQuery`, ampliación L2); tarjetas = Σ `PURCHASE` con `systemCategoryCode = INTEREST` sobre sus cuentas (`AccountMovementsQuery` de `add-credit-cards`); "otros intereses" = total − préstamos − tarjetas **por moneda**. Si una atribución por moneda supera el total (datos inconsistentes, p. ej. un reembolso de interés en otra cuenta), "otros" puede ser negativo: se informa tal cual con `attributionConsistent = false` (nunca se ajusta en silencio).
4. **Fecha estimada libre de deudas (`DebtFreeDateEstimator`).** Por deuda con saldo > 0: préstamo ⇒ `lastUnpaidInstallmentDueDate` del cronograma vigente (`LoanPortfolioQuery`, L2); tarjeta ⇒ por cuenta, `max(vencimiento del ciclo que factura la última cuota pendiente, vencimiento del estado de cuenta que factura el saldo actual)` donde este último es el del estado emitido con saldo por pagar si el saldo actual menos cuotas no facturadas está todo facturado, o el del ciclo abierto si hay compras del ciclo abierto (supuestos: paga el total facturado y no compra más; `CardPortfolioQuery` expone ambos datos, L3) y la tarjeta = máximo de sus cuentas; otros pasivos ⇒ no estimable. Global = máximo de las estimadas; `excluded[]` = no estimables con saldo. Sin deudas ⇒ `null` con `status: NO_DEBT`. Préstamos con cuotas atrasadas: su fecha sigue siendo la de la última cuota (el atraso se ve en próximos vencimientos).
5. **Próximos vencimientos (`UpcomingDebtDues`).** Préstamo: primera cuota no pagada (`nextInstallment {n, dueDate, outstanding, overdueDays}`, L2). Tarjeta, por cuenta: estado de cuenta emitido con `remainingNoInterest > 0` (`dueDate`, `remainingNoInterest`, `remainingMinimum`) o, si no hay, el vencimiento del ciclo abierto con su estimación (`estimated: true`); sin saldo ⇒ no se lista. Orden: atrasados primero (más días primero), luego por fecha, moneda y nombre. Sin ventana fija: uno por deuda (el Home muestra el primero; la vista, todos). No reemplaza a Q8 (`reporting/cash-flow-calendar`), que es la lista de pagos de la ventana.
6. **Home.** La tarjeta "Deudas" llama a `GET W/debts/summary` (el Home ya compone varios endpoints: resumen, próximos pagos, patrimonio). Estados: sin cuentas de pasivo ⇒ `status: NO_LIABILITIES` (texto + acción "Registrar préstamo o tarjeta"); pasivos sin saldo ⇒ `status: NO_DEBT`; si no, `ACTIVE`. Fecha libre de deudas presentada como mes y año en el locale del usuario. Va en la sección "Metas y deudas" del Home (docs/28 §3 boceto Q8/Q9; ubicación final, pregunta 5).
7. **Rendimiento.** Una sola resolución de tasas para total e interés (pedidos fusionados), una llamada por puerto (`AccountCatalogQuery`, `AccountBalancesQuery`, `NominalFlowQuery`, `AccountMovementsQuery` sobre las cuentas de tarjeta, y las dos portfolio queries internas). Objetivo p95 ≤ 300 ms con el seed `large` (como el resumen del Home); sin caché en Phase 4.
8. **Autorización.** VIEWER+ (solo lectura); RLS en todas las lecturas (INV-025). Sin auditoría (lecturas). `ETag` débil del payload para el Home.

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (tag `debts`, `x-openspec-capability: debt/loans`):

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `getDebtSummary` | `GET W/debts/summary` | VIEWER | 200 `DebtSummary`; sin parámetros en Phase 4 (`asOf` = hoy en la zona del workspace) |

`DebtSummary`: `{status: NO_LIABILITIES|NO_DEBT|ACTIVE, asOf, baseCurrency, debts[{kind: LOAN|CREDIT_CARD|OTHER_LIABILITY, id (loanId|cardId|accountId), name, balances[{accountId, outstanding: Money, includedInNetWorth}], estimatedPayoffDate|null, payoffEstimable}], totals {byCurrency: Money[], consolidated: {amount: Money, complete, unconverted: Money[]}}, creditBalances[{accountId, name, amount: Money}], interestYtd {from, to, byCurrency: Money[], consolidated {amount, complete, unconverted[]}, attribution[{kind: LOAN|CREDIT_CARD|OTHER, id|null, name|null, byCurrency: Money[]}], attributionConsistent}, debtFree {date|null, excluded[{kind, id, name}]}, upcomingDues[{kind, id, name, accountId, dueDate, amount: Money, minimum: Money|null, estimated, overdueDays}], meta {ratesUsed[] (ResolvedRate), rateWindowDays}}`. Sin errores nuevos (`INSUFFICIENT_ROLE`/`RESOURCE_NOT_FOUND` estándar). Aditivo (`pnpm contract:breaking`).

**Eventos:** ninguno.

**Contratos entre módulos:** ninguno nuevo publicado. `@pf/debt/contracts` puede exportar `DebtSummaryQuery` para Reporting en Phase 7 (no se implementa consumidor ahora).

## Dependencias

**Consultas que necesito de `add-loans`** (contrastado con su design.md del 2026-10-10: declara `LoanPortfolioQuery.listActiveLoans({workspaceId})` con "principal pendiente, moneda, tasa, cuota, próxima fecha"):

| # | Necesidad | Estado en su borrador | Pedido |
|---|---|---|---|
| L1 | Por préstamo: `loanId`, `name`, `accountId` (cuenta `LOAN`), `currency`, `status` | Parcial (moneda; falta confirmar `accountId` y `name`) | Incluir en `listActiveLoans` |
| L2a | `nextInstallment {n, dueDate, outstanding: Money, overdueDays}` según "hoy" del workspace | Parcial ("cuota, próxima fecha") | Agregar `outstanding` (pendiente de la cuota tras pagos parciales) y `overdueDays` |
| L2b | `lastUnpaidInstallmentDueDate` del cronograma vigente | No | Agregar |
| L2c | Interés imputado en un rango: `interestPaid({workspaceId, from, to}) → [{loanId, byCurrency: Money}]` (Σ imputaciones vigentes con fecha de pago en el rango; las anuladas no cuentan) | Su decisión 11 calcula acumulados totales, no por rango | Agregar el filtro por rango (o `listActiveLoans({…, interestFrom, interestTo})`) |
| L2d | Préstamos saldados con cuenta aún con saldo (diferencia no conciliada, su decisión 11) | Lo expone el detalle | Incluir préstamos no activos con saldo ≠ 0 en la cuenta, o el resumen los trata como "otros pasivos" |

**Consultas que necesito de `add-credit-cards`** (mismo autor; `CardPortfolioQuery.listCards({workspaceId})`, su design.md § Contratos):

| # | Necesidad |
|---|---|
| L3a | Por tarjeta y cuenta: `cardId`, `name`, `accountId`, `currency`, estado de la tarjeta |
| L3b | Último estado emitido con `remainingNoInterest > 0`: `dueDate`, `remainingNoInterest`, `remainingMinimum`; ciclo abierto: `dueDate`, estimación de pago, si tiene compras propias |
| L3c | Cuotas pendientes: vencimiento de la última cuota no facturada y capital no facturado |
| L3d | `AccountMovementsQuery` (Transactions) con `systemCategoryCode` para atribuir el interés de tarjeta |

**Orden:** requiere aplicados `add-loans` y `add-credit-cards` (o, si se adelanta, funciona con lo que exista: sin préstamos ⇒ todas las cuentas `loan` van a "otros pasivos" y no estimables; sin tarjetas ⇒ ídem `credit_card`); además `add-basic-dashboard`, `add-budgets` (`FlowValuation`, `REPORTING_RATE_VALIDITY_WINDOW`), `add-classification` (categoría `INTEREST`). Habilita el payoff simulator (`add-loan-amortization-advanced`, que puede reutilizar `DebtFreeDateEstimator`) y el reporte Debt Evolution de Phase 7.

## Riesgos / Trade-offs

- [Total distinto del patrimonio neto] → mismo universo (pasivos con saldo, ledger) y misma tasa; diferencia solo por pasivos excluidos del patrimonio, marcados; test de consistencia.
- [Fecha libre de deudas engañosa para tarjetas rotativas] → supuesto explícito en la UI ("pagando el total y sin compras nuevas") y deudas no estimables listadas.
- [Atribución de interés que no cuadra (interés registrado en otra cuenta)] → "otros intereses" absorbe la diferencia por moneda y `attributionConsistent` lo delata; nunca se ajusta en silencio.
- [Año calendario vs año del mes financiero (RISK-020)] → año calendario en la zona del workspace (pregunta 4).
- [Rendimiento del Home (RISK-029)] → lecturas en lote, una resolución de tasas; medir con seed `large`.
- [Dependencia de dos changes en diseño paralelo] → necesidades explícitas L1–L3; degradación definida si alguno no está.

## Plan de migración

Sin migraciones ni datos. Despliegue aditivo (endpoint nuevo y tarjeta del Home). Rollback: revertir el despliegue.

## Cambios a docs compartidos

(No aplicados: los consolida el lead.)

- **docs/01 §11**: FR-DEBT-018 — precisar universo (todas las cuentas de pasivo con saldo; saldo a favor aparte), año calendario, atribución del interés y supuestos de la fecha libre de deudas; agregar "próximos vencimientos de deudas" y la tarjeta del Home; evaluar subir a Should (pregunta 1). §21: si el owner adopta "¿cuánto debo y cuándo termino?" como pregunta del Home, agregar la fila con FR-DEBT-018 (hoy Q9 es "¿Voy a cumplir mis metas?").
- **docs/00 §6**: misma decisión sobre la pregunta del Home (no hay una pregunta de deudas entre las 9).
- **docs/04 §3.9**: query `GetDebtSummary` y DS `DebtSummaryCalculator`, `DebtFreeDateEstimator`, `InterestAttribution`.
- **docs/10 §13**: fila `debts` con `GET W/debts/summary` (`debt/loans`, Phase 4); §14 matriz de roles (VIEWER).
- **docs/14 §10**: widget `DebtSummary` del Home en Phase 4 (total, interés del año, fecha libre de deudas, próximo vencimiento); DTI sigue en Phase 7.
- **docs/28**: tarjeta "Deudas" en la sección "Metas y deudas" del Home y pestaña Resumen de `/debts`.
- **docs/03 §7**: `add-debt-summary` después de `add-loans` y `add-credit-cards`.

## Preguntas abiertas

1. **Prioridad.** FR-DEBT-018 es Could, pero el owner lo plantea como pregunta central ("¿cuánto debo y cuándo termino?"). (a) **Subir a Should y hacerlo el último change de Phase 4**; (b) mantener Could (se hace si sobra tiempo). **Recomendación: (a)**; el costo es bajo (sin tablas ni eventos).
2. **Saldo a favor.** (a) **Aparte, sin restar del total adeudado** (decisión 1); (b) restarlo como en la fórmula de docs/14 `Debt(d) = −Σ balance` (el total coincide exactamente con los pasivos del patrimonio). **Recomendación: (a)**: un crédito en la tarjeta no reduce lo que se debe en el préstamo.
3. **Pasivos excluidos del patrimonio neto.** (a) **Incluirlos marcados** ("no incluido en patrimonio"); (b) excluirlos para coincidir con el patrimonio. **Recomendación: (a)**: siguen siendo deudas.
4. **Año del interés pagado.** (a) **Año calendario (1 de enero) en la zona del workspace**; (b) desde el primer periodo financiero del año según el día de inicio del mes financiero (un workspace con inicio el 25 empezaría el 2025-12-25). **Recomendación: (a)**, alineado con la declaración de impuestos y con "YTD" de docs/14.
5. **Ubicación en el Home.** (a) **Sección "Metas y deudas" junto a la tarjeta de metas (docs/28 §3)**; (b) después de "Pagos y compromisos". **Recomendación: (a)**.
6. **Supuesto de la fecha libre de deudas para tarjetas.** (a) **Pagar el total facturado y no comprar más** (fecha cercana y verificable); (b) usar la política del plan de pago (con `MINIMUM` la deuda rotativa no tendría fecha estimable sin estimar el interés rotativo, fuera de alcance). **Recomendación: (a)**, con el supuesto visible.
