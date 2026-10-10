# Diseño

## Contexto

Q5 "¿Cuánto puedo gastar?" (docs/00 §6) se definió como "disponible líquido − comprometido restante del periodo − aportes planificados a metas − reserva mínima configurada; alternativamente, presupuesto restante por categoría", con fuentes Planning + Commitments + Goals y fase "Phase 2 (presupuesto) / Phase 4 (completo)". docs/14 §4.2 la detalla como *Safe to spend* con horizonte "hasta el próximo ingreso esperado". docs/00 dejó abierta la pregunta 3 (¿presupuesto, liquidez libre de compromisos o ambas vistas?). Phase 2 implementó solo la vista de presupuesto dentro del plan (`planning/budgets`, requirement "Disponible para gastar agregado", FR-PLANNING-024) y el Home sigue declarando Q5 no disponible (`reporting/dashboard`, "Preguntas del Home sin datos o no disponibles").

**Evaluación (pedida por el lead): ¿cabe Q5 como change propio en Phase 4? Sí.** Todos los insumos existen o los crea Phase 4 con contratos públicos: saldos de cuentas líquidas (Ledger + Accounts, D35), comprometido y pendientes (`reporting/cash-flow-calendar` sobre `CommittedQuery` de Commitments, D127/D115/D146), reserva mínima (Identity, FR-IDENTITY-005), reservado por cuenta y aportes planificados (`add-savings-goals`), disponible del plan (`BudgetVsActualQuery` de Planning) y valoración (`FxValuationPort`, D53). Pagos de tarjeta (`add-credit-cards`, ocurrencias `CARD_PAYMENT` administradas por DEBT) y cuotas (`add-loans`, `LOAN_PAYMENT`) llegan como ocurrencias del motor y entran solos en el comprometido. El cálculo es una función pura en REPORTING, sin tablas ni eventos: un change chico (11 requirements, ~1 semana) que cierra el objetivo de la fase. No conviene meterlo en `add-savings-goals` (mezclaría la capability de metas con una de Reporting y su dependencia de Commitments/Planning) ni en `planning/budgets` (Planning tendría que depender de Ledger, Goals y Commitments, y Planning ya es fuente de Reporting: ciclo, D109).

Reglas que se respetan: cuenta líquida = `ASSET` + `LIQUID`, no archivada (D35); transferencias en el comprometido solo de líquida a no líquida (D127); montos `VARIABLE` no suman y se cuentan (D115); valoración con la selección de tasa del Home (D29/D34/D38/D48) y ventana de vigencia de REPORTING (D53); redondeo HALF_EVEN solo al presentar (NFR-DATA-002); lectura directa de las fuentes como Q4/Q8 (D117); "hoy" y periodo en la zona y el día de inicio del workspace (D59, RISK-020); nunca un número inventado (FR-REPORTING-001).

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Reporting | DS puro `SpendableCalculator` (términos por moneda, tope de reservas por cuenta, exclusiones del comprometido, faltante por moneda, estado `OK\|WARNING`); query `GetSpendable`; bloque `spendable` del resumen; métrica `reporting_spendable_duration_seconds` | domain/application | Nuevo |
| Commitments | `CommittedQuery.listForSpendable({workspaceId, periodFrom, periodTo})` (aditivo): ítems de egreso no resueltos (ocurrencias del periodo y vencidas anteriores) y pendientes con fecha ≤ `periodTo`, con `accountId`, `toAccountId`, `sourceLiquid`, `targetLiquid`, `kind`, `managedBy`, `amount\|null`, `overdueFromPrevious` | application/contracts | Ampliación aditiva (S1) |
| Identity | `WorkspaceSettingsQuery.getMinimumLiquidityReserve(workspaceId)` en `contracts` (aditivo) | contracts | Ampliación aditiva (S2) |
| Goals | Sin cambios: `GoalReservationsQuery.getReservedByAccount` y `GoalPlansQuery.getForPeriod` de `add-savings-goals` | — | Consumo |
| Planning | Sin cambios: `BudgetVsActualQuery.getForPeriod` (`totals.availableToSpend`) y `PeriodQuery` | — | Consumo |

## Objetivos / No objetivos

**Objetivos:**
- Una cifra de Q5 explicable término por término, conservadora (no cuenta ingresos futuros) y sin doble conteo entre compromisos, metas y tarjetas.
- La misma valoración y las mismas reglas de comprometido que Q1/Q4, para que las cifras del Home cuadren entre sí.
- Mostrar también la vista de presupuesto de Phase 2 sin cambiarla.

**No objetivos:**
- Horizonte "hasta el próximo ingreso", saldo diario esperado y riesgo de déficit (Phase 7).
- Presupuesto restante de categorías esenciales y gasto variable predicho (Phase 7 / 8).
- Persistir, notificar o versionar el disponible.

## Decisiones

1. **Capability y ubicación.** Requirements en `reporting/dashboard` (KPI "disponible para gastar" de FR-REPORTING-002, pregunta del Home). El cálculo vive en REPORTING, consumidor de todos los contextos (docs/05 §2.14); no se crea capability nueva (ARCHITECTURE §14 no cambia; pregunta 9).
2. **Fórmula por moneda `c` y periodo `P` (el que contiene hoy):** `disponible_c = líquido_c − reservadoMetas_c − comprometido_c − aportesPlanificados_c − reservaMínima_c`. Cada término se calcula y se informa por moneda en Decimal (precisión 40); se agregan por moneda **antes** de convertir. Ingresos esperados (ocurrencias `INCOME` y pendientes de ingreso) no suman (docs/14 §4.2 "conservador").
3. **Líquido.** Σ saldo contable de las cuentas `ASSET` con liquidez `LIQUID` no archivadas (las `CLOSED` tienen saldo 0), igual que "dinero disponible" del Home (D35). `SEMI_LIQUID` e `ILLIQUID` no cuentan (pregunta 7).
4. **Reservado para metas.** Para cada cuenta líquida: `min(max(saldo, 0), reservado(cuenta))` con `reservado` de `GoalReservationsQuery` (reservas vigentes + aportes reales en la cuenta, metas `ACTIVE|PAUSED|ACHIEVED`; `add-savings-goals` decisión 5). El tope evita restar dos veces el faltante de una cuenta sobre-asignada (pregunta 8). Reservas sobre cuentas no líquidas no restan (ese dinero ya no está en "líquido").
5. **Comprometido.** De `CommittedQuery.listForSpendable` (S1), se suman los ítems con `sourceLiquid = true` que sean: ocurrencias de egreso no resueltas con vencimiento en `P` (incluidas las atrasadas de `P`) — `EXPENSE` y `TRANSFER`/`CARD_PAYMENT`/`LOAN_PAYMENT` con `targetLiquid = false` —, ocurrencias atrasadas de periodos anteriores sin resolver (`overdueFromPrevious`, pregunta 3) y transacciones `PENDING` de egreso con fecha ≤ fin de `P` (incluidas las de fechas anteriores; sin asiento, no están en el saldo; pregunta 4). Se excluyen: ítems con `sourceLiquid = false` (compras con tarjeta: se descuentan cuando se paga la tarjeta, pregunta 5), transferencias entre líquidas (D127), ítems con `managedBy = GOAL` (los cubre el término de aportes planificados: evita el doble conteo del aporte programado de una meta hacia una cuenta no líquida) y ocurrencias `VARIABLE` (se informa `withoutAmountCount`, D115). `MIN_MAX` por su máximo. Una ocurrencia materializada como pendiente cuenta una sola vez (la consulta de Commitments ya lo garantiza). S1 es un método nuevo y no un filtro sobre `getForRange` porque Q4 (D146) no suma los atrasados anteriores ni todas las pendientes, y porque los ítems de Q4 no traen cuentas ni liquidez.
6. **Aportes planificados.** Σ `pending` de `GoalPlansQuery.getForPeriod(P)` (metas `ACTIVE` con plan; pausadas, alcanzadas, cerradas y canceladas no suman), por moneda de la meta. Para una meta con plan programado (`managedBy = GOAL`) la ocurrencia del motor se excluye del comprometido (decisión 5) y su pendiente se cuenta aquí; cuando la ocurrencia se materializa y se postea, el aporte reduce el pendiente y el saldo líquido baja o pasa a reservado, sin doble efecto.
7. **Reserva mínima.** `WorkspaceSettingsQuery.getMinimumLiquidityReserve` (S2; FR-IDENTITY-005) en su moneda; `null` ⇒ término omitido (no 0.00 en el desglose).
8. **Consolidado.** Cada `disponible_c` con `c ≠` moneda de reporte se convierte con la tasa de valoración vigente al consultar (`FxValuationPort`, tipo preferido del par, `windowDays = REPORTING_RATE_VALIDITY_WINDOW`, fallback D34/D38), igual que el líquido del Home; sin tasa ⇒ `unconverted[]` y `complete = false` (nunca 1:1). Los negativos se convierten igual (un faltante en USD resta del consolidado). HALF_EVEN solo al presentar. `meta.ratesUsed[]` con tipo, fuente, vigencia y antigüedad.
9. **Faltante por moneda y negativo.** Si algún `disponible_c < 0` y el consolidado ≥ 0 ⇒ `shortfalls[{currency, amount}]` y la UI indica "en BOB faltan X; conviene convertir". Consolidado < 0 ⇒ `status = WARNING`, se muestra con signo y desglose (nunca 0.00 ni oculto).
10. **Vista según el presupuesto.** `BudgetVsActualQuery.getForPeriod(P)`: `totals.availableToSpend` (FR-PLANNING-024, sin cambios) como `budgetView {status: AVAILABLE, amount, complete, budgetId}`; sin plan ⇒ `budgetView {status: NO_PLAN, action: CREATE_BUDGET}`. No se mezclan ni se toma el mínimo de ambas (pregunta 1).
11. **Periodo y hoy.** `P` = periodo financiero que contiene hoy en la zona del workspace (`PeriodQuery`/calendario financiero puro de `add-savings-goals` N8); vencimientos posteriores a `P` no restan (pregunta 2). Cerca del fin del periodo la tarjeta muestra un enlace a Q8 ("próximos pagos del periodo siguiente").
12. **API.** `GET W/reports/spendable` (`getSpendable`, VIEWER): `{period {id, label, start, end}, reportingCurrency, byCurrency[{currency, liquid, reservedForGoals, committed, plannedGoalContributions, minimumReserve, spendable}], consolidated {total, complete, unconverted[]}, shortfalls[], status: OK|WARNING, withoutAmountCount, committedItems[] (detalle), budgetView, meta {ratesUsed[], rateWindowDays, generatedAt, dataFreshness}}`. `ReportSummary.spendable` (aditivo) lleva `byCurrency`, `consolidated`, `status`, `shortfalls`, `withoutAmountCount` y `budgetView` sin el detalle de ítems; `homeQuestions.Q5.status` pasa a `AVAILABLE` o `NO_DATA` (sin cuentas líquidas, acción `CREATE_ACCOUNT`).
13. **Lectura directa y consistencia.** Todo se lee en la transacción de lectura de la petición (read-your-writes), como Q4/Q8 (D117): una reserva o un pago recién registrados se reflejan en la siguiente consulta. Una sola resolución de tasas por petición; lecturas por lote. Métrica `reporting_spendable_duration_seconds` (sin etiquetas de alta cardinalidad); si el p95 supera 300 ms sostenido, la alerta `UpcomingPaymentsReadModelRecommended` de D117 cubre el mismo camino de lectura (se amplía su expresión para incluir esta métrica; sin alerta nueva).
14. **Autorización y aislamiento.** VIEWER+ (FR-IDENTITY-006); RLS por workspace en todas las lecturas (INV-025). Sin auditoría (lectura).

## Contratos

Cambios requeridos (se consolidan al implementar; este PR de planificación no edita `contracts/`).

**`contracts/openapi/finance-api.v1.yaml`:** `getSpendable` `GET W/reports/spendable` (tag `reports`, `x-openspec-capability: reporting/dashboard`, `x-required-role: VIEWER`), schema `Spendable` (decisión 12), `SpendableBudgetView`, `SpendableCurrencyTerms`; `ReportSummary.spendable` aditivo; `HomeQuestionStatus` sin valores nuevos (`AVAILABLE`, `NO_DATA`, `NOT_AVAILABLE_IN_PHASE` ya existen). Sin códigos de error nuevos.

**Contratos entre módulos:**
- `@pf/commitments/contracts` → `CommittedQuery.listForSpendable({workspaceId, periodFrom, periodTo}) → {items[{source: OCCURRENCE|PENDING, id, definitionId|null, name|null, kind, date, accountId, toAccountId|null, sourceLiquid, targetLiquid|null, managedBy|null, amount: MoneyDto|null, overdueFromPrevious}], withoutAmountCount}` (S1; Commitments ya resuelve la liquidez para D127).
- `@pf/identity/contracts` → `WorkspaceSettingsQuery.getMinimumLiquidityReserve({workspaceId}) → MoneyDto|null` (S2).
- `@pf/goals/contracts` (de `add-savings-goals`) → `GoalReservationsQuery.getReservedByAccount`, `GoalPlansQuery.getForPeriod`.
- `@pf/planning/contracts` → `BudgetVsActualQuery.getForPeriod`, `PeriodQuery` (existentes).

**Eventos:** ninguno.

## Dependencias con otros changes

| # | Necesidad | Estado | Qué hace este change |
|---|---|---|---|
| S1 | `CommittedQuery.listForSpendable` con cuentas, liquidez y `managedBy` | **Pedido** (aditivo en Commitments) | Lo implementa sobre la misma lectura de `getForRange` |
| S2 | Reserva mínima por `contracts` de Identity | **Pedido** (aditivo) | Lo agrega |
| S3 | `GoalReservationsQuery` y `GoalPlansQuery` | `add-savings-goals` (decisiones 5 y 17) | **Requiere** `add-savings-goals` archivado; también porque ambos modifican "Preguntas del Home sin datos o no disponibles" (este va después) |
| S4 | Pagos de tarjeta y cuotas como ocurrencias de egreso de líquida a no líquida | `add-credit-cards` (`CARD_PAYMENT`, decisión 7) y `add-loans` (`LOAN_PAYMENT`, decisión 9) | Dependencia blanda: sin ellos, Q5 funciona con las transferencias recurrentes del usuario hacia la tarjeta (D116); con ellos, entran sin cambios porque S1 trata `CARD_PAYMENT`/`LOAN_PAYMENT` como transferencias hacia un pasivo |
| S5 | `managedBy = GOAL` en las ocurrencias | `add-savings-goals` N5 | Exclusión del comprometido (decisión 5) |

**Orden propuesto (docs/03 §7):** último change de Phase 4, después de `add-savings-goals` y, si es posible, de `add-credit-cards` y `add-loans` (para verificar el exit criterion con los pagos reales del owner).

## Riesgos / Trade-offs

- [Doble conteo comprometido ↔ aportes a metas] → exclusión por `managedBy = GOAL` (decisión 5); un aporte manual pendiente hacia una cuenta no líquida de una meta con plan sí podría contar dos veces hasta postearse (raro; aceptado y documentado en la ayuda).
- [Subestimar gastos con tarjeta sin plan de pago] → la compra con tarjeta no resta hasta que hay un pago programado o pendiente; la UI muestra "N tarjetas sin pago programado" (pregunta 5).
- [Fin de periodo] → el 30 de octubre el disponible no descuenta el alquiler del 1 de noviembre; enlace a Q8 y horizonte por ingreso en Phase 7 (pregunta 2).
- [Rendimiento del Home (NFR-PERF-004)] → lecturas por lote y una resolución de tasas; métrica y alerta de D117.
- [Confusión entre las dos vistas] → rótulos fijos ("libre de compromisos" / "según tu presupuesto") y desglose siempre visible.

## Plan de migración

Sin migraciones ni datos. Despliegue: métodos aditivos en `contracts` de Commitments e Identity, endpoint nuevo y bloque aditivo del resumen; la web muestra Q5 cuando la API devuelve `spendable`. Rollback: revertir el despliegue (Q5 vuelve a "no disponible").

## Cambios a docs compartidos

- **docs/00 §6 (Q5)** y **pregunta abierta 3**: resuelta como "ambas vistas: libre de compromisos (principal) y según el presupuesto (secundaria)", horizonte = periodo financiero en Phase 4.
- **docs/01**: FR-PLANNING-024 — aclarar que el "disponible para gastar" agregado del plan es la vista de presupuesto de Q5; la vista completa la da `reporting/dashboard` (Phase 4). FR-REPORTING-002 — KPI "disponible para gastar" Phase 4. **§19 (matriz Q)**: Q5 → + FR-GOALS-004, FR-IDENTITY-005, `reporting/dashboard`.
- **docs/10 §13**: fila `reports` + `GET W/reports/spendable` (`getSpendable`, VIEWER); §13.1 bloque `spendable` del resumen.
- **docs/14 §4.2**: as-built de Phase 4 (periodo financiero, términos y exclusiones de la decisión 5, tope de reservas, sin "esenciales" ni horizonte por ingreso hasta Phase 7). **§9.1**: Q5 `SafeToSpendCard` Phase 4.
- **docs/18**: métrica `reporting_spendable_duration_seconds` y su inclusión en la alerta `UpcomingPaymentsReadModelRecommended`.
- **docs/28**: tarjeta Q5 del Home (cifra principal, segunda vista, desglose, faltante por moneda, estado de alerta) y vista de detalle.
- **docs/03 §7**: `add-spendable-amount` como último change de Phase 4.
- **tests/cases/reporting/TC-REPORTING-DASHBOARD-005**: ninguna pregunta queda no disponible por fase.

## Preguntas abiertas

1. **[B] Base de Q5** (docs/00 pregunta 3). Opciones: (a) **ambas vistas: libre de compromisos como cifra principal y "según tu presupuesto" como segunda** (spec); (b) solo libre de compromisos; (c) solo presupuesto (lo de Phase 2); (d) una sola cifra = mínimo de ambas. **Recomendación: (a)**: la liquidez responde "¿me alcanza?" y el presupuesto "¿me lo permití?"; el mínimo esconde cuál limita. Bloquea la forma de la respuesta y la UI.
2. **[B] Horizonte.** Opciones: (a) **periodo financiero que contiene hoy** (docs/00 "comprometido restante del periodo"; mismo periodo que Q4, presupuestos y aportes planificados); (b) hasta el próximo ingreso esperado, 30 días si no hay (docs/14 §4.2). **Recomendación: (a)** en Phase 4; (b) llega con el cash-flow calendar de Phase 7, que ya tiene ese horizonte.
3. **Vencidos de periodos anteriores.** Q4 los muestra aparte y no los suma (D146). Para Q5: (a) **restarlos** (siguen sin pagarse y saldrán de la cuenta); (b) no restarlos, como Q4. **Recomendación: (a).**
4. **Pendientes con fecha anterior al periodo.** (a) **Restar todas las pendientes de egreso con fecha ≤ fin del periodo**; (b) solo las del periodo, como Q4. **Recomendación: (a)**: no están en el saldo contable.
5. **Tarjetas sin plan de pago.** Las compras con tarjeta no restan hasta que hay un pago programado (`CARD_PAYMENT` de `add-credit-cards` o transferencia recurrente) o pendiente. Opciones: (a) **así, con aviso "N tarjetas sin pago programado"**; (b) restar el saldo adeudado de las tarjetas con vencimiento en el periodo aunque no haya plan (requiere consultar Debt y riesgo de doble conteo con el plan). **Recomendación: (a).**
6. **Reserva mínima en otra moneda.** Se resta en su moneda (y se consolida con la tasa vigente). **Recomendación:** así.
7. **Cuentas `SEMI_LIQUID`.** No cuentan como líquidas (D35). **Recomendación:** así.
8. **Tope del reservado en el saldo de la cuenta.** (a) **tope** (una cuenta sobre-asignada aporta como mínimo 0 al disponible y la sobre-asignación se avisa aparte); (b) restar todo lo reservado (el faltante resta dos veces). **Recomendación: (a).**
9. **Capability.** (a) **`reporting/dashboard`** (KPI del Home; sin capability nueva); (b) capability nueva `reporting/spendable-amount` (requiere aceptación como D108); (c) `planning/budgets` (ciclo Planning ↔ Reporting). **Recomendación: (a).**
10. **Aviso de disponible negativo.** **Recomendación:** no en Phase 4; el riesgo de déficit con alerta es FR-REPORTING-015 (Phase 7).
