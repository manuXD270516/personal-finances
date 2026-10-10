# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: docs/00 §6 (Q4 "Σ de ocurrencias recurrentes pendientes del periodo + transacciones `pending`"; Q8 "próximos N días de ocurrencias recurrentes … con saldo esperado") y §8 (SM-07 "0 pagos recurrentes conocidos no anticipados por mes; comparar ocurrencias vs transacciones no planificadas"); docs/01 FR-REPORTING-016 (Must, Phase 3), FR-COMMITMENTS-004/011, FR-LEDGER-013 (capability `reporting/cash-flow-calendar`, D21); docs/14 §2.2 ("Liquid balance / Safe to spend: ledger directo + Commitments/Planning queries — inputs pequeños"), §3 (`Upcoming commitments(h)` y `Pending outflows` con `conv_v(hoy)`), §9.1 (`CommittedCard` y `UpcomingPaymentsList`); docs/24 §5.3 (alcance y exit criteria de Phase 3) y §5.7 (calendario en Phase 7); docs/28 §3 (Home, prioridad móvil Q4); docs/31 D14/D15/D29/D34/D35/D53/D55 y docs/33 D104/D109 (valoración compartida, ventana de vigencia, tarjeta compacta en el Home con enlace a la vista completa).

Este change agrega a **REPORTING** la capability `reporting/cash-flow-calendar` en su versión simple. Reporting **no es dueño** de los compromisos: el motor (`add-recurrence-engine`, capability `commitments/recurrence-engine`, diseñado en paralelo) define qué es una ocurrencia no resuelta, el total comprometido del periodo (FR-COMMITMENTS-011) y la materialización. Reporting **presenta** esa información en el Home y en una vista, la **valora** en la moneda de reporte con la misma valoración que el resto del Home y le suma lo que solo Reporting combina: saldo proyectado (Ledger + Transactions) e indicador de pagos sorpresa.

| Capa | Cambios |
|---|---|
| domain | `UpcomingPaymentsAssembler` (puro: ordena, marca vencidos con días de atraso, aplica el tipo de monto — `FIXED`, `ESTIMATED`, `MIN_MAX` con máximo en totales, `VARIABLE` sin monto —, cuenta "sin monto", separa vencidos de periodos anteriores); `ProjectedBalanceCalculator` (contable + Σ pendientes con signo); `SurprisePaymentClassifier` (fecha local de generación ≥ fecha de la transacción); `homeQuestions` habilita Q4/Q8 con `NO_DATA`/`CREATE_COMMITMENT`. |
| application | Queries `GetUpcomingPayments` y `GetSurprisePayments` en una `ReportingUnitOfWork` de lectura (RLS); puertos nuevos `UpcomingCommitmentsPort` y `PendingTransactionsPort`; reutiliza `FinancialPeriodsPort`, `AccountCatalogQuery`, `AccountBalancesQuery`, `FxValuationPort`, `WorkspaceSettingsPort`, `DataVersionStore`, `Clock` y `FlowValuation` (shared-kernel). |
| infrastructure | Ninguna tabla nueva. `REPORTING_INVALIDATING_EVENTS` + eventos de Commitments y `transactions.TransactionCreated.v1`. |
| interface | `ReportingController`: `getUpcomingPayments`, `getSurprisePayments`; composición en `apps/api` de los adapters hacia `@pf/commitments/contracts` y `@pf/transactions/contracts`. Web: tarjetas Q4/Q8 del Home y vista `/pagos-proximos` (i18n es/en/pt). |

## Objetivos / No objetivos

**Objetivos:** responder Q8 (lista simple) y Q4 (total del periodo) en el Home con números honestos; saldo proyectado por cuenta (FR-LEDGER-013); medir SM-07; cero tablas nuevas y lectura de la fuente de verdad.

**No objetivos:** calendario 7/30/60/90 con saldo esperado diario, saldo más bajo y riesgo de déficit (FR-REPORTING-014/015, Phase 7: se deja explícitamente para `reporting/cash-flow-calendar` completo, junto con NFR-PERF-010); ingresos esperados en la lista; cuotas y vencimientos de tarjeta (Phase 4); safe to spend con compromisos (docs/14 §4.2, Phase 4/7); proyección `reporting.commitment_occurrence` (Phase 7); compromisos en el plan mensual (pregunta abierta 3); notificaciones (las agrega `add-recurrence-engine`).

## Decisiones

1. **Lectura de la fuente de verdad, sin read model propio en Phase 3.** `GetUpcomingPayments` consulta, dentro de una transacción de lectura con `SET LOCAL app.workspace_id`, el contrato público de Commitments (ocurrencias no resueltas y total del periodo), el de Transactions (pendientes), el de Ledger (saldos contables) y FX (tasas), igual que `GetReportSummary` (D14/D15, docs/14 §2.2: los insumos de compromisos son pequeños — ≤ 60 definiciones × 90 días según NFR-PERF-009). Los eventos de Commitments **solo** incrementan `reporting.workspace_data_version` (consumidor existente `reporting.data-version`) para el `ETag`/frescura. Ventajas: read-your-writes tras aprobar/omitir/vincular (requirement de frescura), cero proyección que reconstruir o exportar, sin carrera entre el consumidor y la UI. **Alternativa descartada para Phase 3:** proyección `reporting.commitment_occurrence` alimentada por `commitments.OccurrencesGenerated.v1`/`RecurringOccurrenceMaterialized.v1`/`RecurringOccurrenceChanged.v1` (docs/14 §2.1): agrega rebuild, deriva, sección de export y un lag visible justo en la acción más frecuente (aprobar un pago), para un volumen que no lo necesita; llega con el calendario de Phase 7 si NFR-PERF-010 lo exige. Pregunta abierta 1 (el pedido del lead mencionaba "read model desde eventos").
2. **Puertos declarados en Reporting, adapters en la composición.** Como con `FinancialPeriodsPort` (Planning depende de Reporting), Reporting declara `UpcomingCommitmentsPort` y `PendingTransactionsPort` en `application/ports` y `apps/api` entrega adapters a `@pf/commitments/contracts` y `@pf/transactions/contracts`. Reporting no importa `@pf/commitments` (evita un ciclo si Commitments llegara a leer valoraciones de Reporting) y los contextos siguen sin importarse entre sí (dependency-cruiser).
3. **Unión y deduplicación en Commitments; presentación y valoración en Reporting.** El ítem "comprometido" es: (a) una ocurrencia de egreso no resuelta (`SCHEDULED`, `DUE`, `OVERDUE`), o (b) una transacción `PENDING` de egreso; una ocurrencia materializada como pendiente es **solo** (b), con `occurrenceId`/`definitionName` de origen (Commitments lo sabe por `external_ref_namespace = 'commitments.occurrence'`). Para no duplicar la regla de FR-COMMITMENTS-011, Reporting pide a Commitments la **lista unificada** y el **total del periodo** en montos nativos por moneda, y solo valora/presenta (pregunta abierta 2). Si `add-recurrence-engine` expone solo ocurrencias, el `UpcomingPaymentsAssembler` une con `PendingTransactionsPort` y descarta las pendientes cuyo `externalRef` apunta a una ocurrencia ya listada (mismo resultado, TC-REPORTING-UPCOMING-007).
4. **Ventana y "hoy" en la zona del workspace.** `today = localDate(clock.now(), workspace.timeZone)`; ventana `[today, today + N]` inclusiva (N por defecto 30, 1..90, alineado con el horizonte de generación de 90 días; `INVALID_FILTER` fuera de rango). Los vencidos (ocurrencias no resueltas con `dueDate < today`) se listan siempre, de cualquier fecha, con `daysOverdue = today − dueDate`. El orden es `dueDate` ascendente, luego nombre (collation del locale del usuario solo en la UI; la API ordena por nombre normalizado y luego id para determinismo).
5. **Fecha de un ítem.** Ocurrencia: `dueDate` (ajustada por fin de semana; la clave nominal no se muestra). Transacción pendiente: su fecha de negocio. Una pendiente con fecha anterior a hoy no es "vencida" (ya está registrada): se marca `PENDING`, no `OVERDUE`.
6. **Tipo de monto (FR-COMMITMENTS-004).** `FIXED` → `amount`; `ESTIMATED` → `amount` + `estimated: true`; `MIN_MAX` → `range {min, max}` y `amountForTotals = max` (peor caso); `VARIABLE` → `amount: null`, `withoutAmount: true`, excluido de los totales (`withoutAmountCount`). Una ocurrencia con monto editado para esa ocurrencia usa el editado (lo informa Commitments). Una pendiente usa su monto real.
7. **Valoración con `FlowValuation` (D109).** Cada ítem se presenta como `DatedAmount` con `date = today` (no su `dueDate`): las fechas futuras no tienen tasa propia y `FlowValuation.rateRequests` acota toda tasa a `now`, así que usar `today` produce **una** conversión por moneda con la tasa del tipo preferido vigente al consultar — exactamente `conv_v(hoy)` de docs/14 §3 — y también para los vencidos (lo que se debe hoy se valora hoy). Ventana `REPORTING_RATE_VALIDITY_WINDOW` (D53); fallback de tasa como el Home (D29/D34); sin tasa ⇒ `unconverted`, `complete: false`; nunca 1:1; HALF_EVEN solo al presentar (por ítem para mostrar, pero el total se calcula sin redondeo intermedio: TC-REPORTING-UPCOMING-011). `meta.rates[]` informa tasa, tipo, fuente con atribución, vigencia y antigüedad (mismo DTO que el resumen).
8. **Total comprometido del periodo (Q4).** Periodo = el que contiene `today` (`FinancialPeriodsPort`, respeta `fiscalMonthStartDay` y la etiqueta del mes de inicio, D59). Total = lo que Commitments informa para el periodo (ocurrencias de egreso no resueltas con `dueDate` en el periodo + pendientes de egreso con fecha en el periodo, sin doble conteo), valorado como la decisión 7, con desglose `fromCommitments` / `fromPending` y `withoutAmountCount`. Las ocurrencias **vencidas de periodos anteriores** se informan aparte (`overdueFromPreviousPeriods`) y no suman: el total del periodo no cambia de significado según la antigüedad de una deuda olvidada, y la tarjeta igual la muestra (pregunta abierta 4, coordinación con `add-recurrence-engine`).
9. **Saldo proyectado (FR-LEDGER-013).** Por cuenta no archivada: `projected = booked + Σ ingresos pendientes − Σ egresos pendientes` (transferencias pendientes, si existen, con el signo de la pata de la cuenta). Sin ocurrencias no materializadas (eso es el saldo esperado del calendario de Phase 7). Por moneda de la cuenta, sin consolidar (la consolidación de la liquidez proyectada llega con safe to spend). Se trae desde Phase 7 porque es trivial con los mismos puertos y responde la mitad de Q8 "con saldo esperado" (pregunta abierta 5).
10. **Pagos sorpresa (SM-07).** Medida objetiva y derivable sin datos nuevos del usuario: un pago sorpresa del periodo P es una transacción de egreso no anulada con fecha en P que **resolvió** una ocurrencia (materializada o vinculada) cuya fecha local de generación (`generatedAt` en la zona del workspace) es **igual o posterior** a la fecha de la transacción. Captura los dos casos reales: definición creada después de pagar ("me olvidé del seguro") y anticipación nula. Una ocurrencia generada al menos un día antes estuvo en la lista ⇒ fue anticipada. Omitidas no cuentan; una transacción anulada libera la ocurrencia (Commitments) y deja de contar. Limitación declarada en la UI: pagos recurrentes **nunca modelados** no se ven (la detección automática es Phase 6+, `SubscriptionDetector`). Periodo no terminado ⇒ `partial: true`. Exit criterion de Phase 3: el indicador del periodo cerrado de prueba en 0 (pregunta abierta 6).
11. **Home.** Tarjeta Q8: `getUpcomingPayments?days=7`, hasta 5 ítems (vencidos y pendientes incluidos, por orden de la decisión 4) + "y N más" + enlace a `/pagos-proximos` (patrón de D104). Tarjeta Q4: bloque `committed` de la misma respuesta (una sola petición para ambas tarjetas, en paralelo con `getReportSummary`). `homeQuestions`: Q4/Q8 `AVAILABLE` si hay ≥ 1 definición activa o ≥ 1 pendiente; si no, `NO_DATA` con `actionHint: CREATE_COMMITMENT` (sin montos); sin cuentas, `NO_DATA`/`CREATE_ACCOUNT` como hoy. Móvil: orden de docs/28 §3 (Q4 temprano).
12. **Vista `/pagos-proximos`.** Selector 7/14/30/60/90 días (por defecto 30), lista con estado (vencido, pendiente, programado, por aprobar), cuenta, tipo de monto, total por moneda y consolidado con tasas, bloque "comprometido del periodo", saldo proyectado por cuenta y el indicador de pagos sorpresa del periodo con su detalle. Acciones de la ocurrencia (aprobar, omitir, vincular) enlazan a la pantalla Recurrentes de `add-recurrence-engine` (no se duplican aquí).
13. **Frescura y caché.** `ETag = hash(dataVersion, today, days, reportingCurrency)`: el día local forma parte de la clave porque los días de atraso y la ventana cambian a medianoche aunque no haya eventos. `meta { window, period, reportingCurrency, generatedAt, dataFreshness, rateWindowDays }`. Tras una acción del usuario, la UI invalida la consulta (TanStack Query) y la lectura de la fuente de verdad garantiza read-your-writes.
14. **Permisos.** VIEWER+ (lectura), como el resumen. RLS en cada contrato consultado.

## Contratos

### OpenAPI (aditivo)

| Operación | Ruta | Rol | Respuesta |
|---|---|---|---|
| `getUpcomingPayments` | `GET W/reports/upcoming-payments?days=30&reportingCurrency=` | VIEWER | `UpcomingPayments` · 304 con `If-None-Match` · 400 `INVALID_FILTER` (`days` ∉ 1..90) · 422 `CURRENCY_NOT_ENABLED` |
| `getSurprisePayments` | `GET W/reports/surprise-payments?period=YYYY-MM` (por defecto el periodo vigente) | VIEWER | `SurprisePayments` · 404 `RESOURCE_NOT_FOUND` (periodo inexistente) |

`UpcomingPayments`:
`{ window: {from, to, days}, items: [{ kind: OCCURRENCE|PENDING_TRANSACTION, occurrenceId?, definitionId?, transactionId?, name, accountId, accountName, date, status: SCHEDULED|DUE|OVERDUE|PENDING_APPROVAL|PENDING, daysOverdue?, amountType: FIXED|ESTIMATED|MIN_MAX|VARIABLE|ACTUAL, amount: Money|null, range?: {min: Money, max: Money}, estimated: boolean, withoutAmount: boolean, converted: Money|null }], totals: { byCurrency: Money[], consolidated: { amount: Money, complete, unconverted: Money[] }, withoutAmountCount }, committed: { periodId, label, from, to, total: {byCurrency, consolidated}, fromCommitments: {byCurrency, consolidated}, fromPending: {byCurrency, consolidated}, withoutAmountCount, overdueFromPreviousPeriods: {count, byCurrency, consolidated} }, projectedBalances: [{ accountId, accountName, currency, booked: Money, pendingIn: Money, pendingOut: Money, projected: Money }], hasCommitments: boolean, meta: { reportingCurrency, generatedAt, dataFreshness, rateWindowDays, rates: ValuationRate[], approx } }`.

`SurprisePayments`: `{ periodId, label, from, to, partial, count, items: [{ transactionId, date, name, amount: Money, occurrenceId, definitionId, generatedOn }], note: "UNLINKED_PAYMENTS_NOT_DETECTED" }`.

Montos como string decimal con moneda (ADR-0006); `ACTUAL` = monto real de una transacción pendiente. `x-openspec-capability: reporting/cash-flow-calendar`; sin `x-rate-limit: costly` (lectura barata). `actionHint` gana el valor `CREATE_COMMITMENT` (conjunto abierto, aditivo).

### Contratos que este change necesita de otros contextos (coordinar con `add-recurrence-engine`)

| Contexto | Contrato (en su `contracts`) | Uso |
|---|---|---|
| COMMITMENTS | `UpcomingPaymentsQuery.listUpcoming({ workspaceId, through: LocalDate })` → ítems unificados (ocurrencias de egreso no resueltas con `dueDate ≤ through`, de cualquier antigüedad, y pendientes de egreso, sin doble conteo) con `occurrenceId, definitionId, definitionName, kind, accountId, toAccountId?, dueDate, status, amountType, amount|null, min?, max?, editedForOccurrence, transactionId?` | Lista (decisiones 3–6) |
| COMMITMENTS | `CommittedQuery.getForRange({ workspaceId, from, to })` → `{ fromCommitments: Money[], fromPending: Money[], withoutAmountCount, overdueBefore: { count, amounts: Money[] } }` (nativo por moneda) | Q4 (decisión 8); la ruta `GET W/recurring/committed` de `add-recurrence-engine` usa la misma query |
| COMMITMENTS | `ResolvedOccurrencesQuery.listResolvedOutflows({ workspaceId, from, to })` → `{ occurrenceId, definitionId, definitionName, generatedAt: Instant, resolution: MATERIALIZED|MATCHED, transactionId, transactionDate, amount: Money }` (solo transacciones no anuladas) | SM-07 (decisión 10) |
| COMMITMENTS | `DefinitionStatsQuery.hasActiveDefinitions({ workspaceId })` | `homeQuestions` (decisión 11) |
| TRANSACTIONS | `PendingFlowQuery.listPending({ workspaceId, accountIds?, dateTo? })` → `{ transactionId, accountId, direction: IN|OUT, amount: Money, date, description, externalRef? }` (propuesto por `add-recurrence-engine`) | Saldo proyectado; fallback de la decisión 3 |
| LEDGER | `AccountBalancesQuery` (existente) | Saldo contable |
| PLANNING | `PeriodQuery` vía `FinancialPeriodsPort` (existente) | Periodo vigente |
| FX | `FxValuationPort` (existente) | Tasas |

### Eventos consumidos (solo versión de datos)

`commitments.OccurrencesGenerated.v1`, `commitments.RecurringOccurrenceMaterialized.v1`, `commitments.RecurringOccurrenceChanged.v1`, `commitments.RecurringDefinitionChanged.v1` (nombres de `add-recurrence-engine`) y `transactions.TransactionCreated.v1` (una pendiente nueva). Idempotencia: `platform.inbox` del consumidor `reporting.data-version` (un duplicado no incrementa). Volumen bajo (lotes por definición y ventana); no afecta NFR-PERF-008.

## Modelo de datos

Sin tablas ni columnas nuevas; sin sección nueva en el export del workspace (no hay datos propios). `reporting.workspace_data_version` ya existe.

## Riesgos / Trade-offs

- **Dependencia fuerte de `add-recurrence-engine`**: nombres de estados, eventos y queries se tomaron de su proposal (2026-10-09); cualquier cambio allí se refleja en la tabla de contratos de arriba. Mitigación: el adapter es la única pieza acoplada; tests de contrato del adapter.
- **Doble conteo ocurrencia ↔ pendiente** (el error más probable): regla única en Commitments (decisión 3) y TC-REPORTING-UPCOMING-007/008.
- **Rendimiento del Home** (NFR-PERF-004): una consulta extra en paralelo; el peor caso son 60 definiciones × 90 días = 5 400 ocurrencias en 90 días (lista larga solo en la vista; la tarjeta pide 7 días). Índice `(workspace_id, due_date) WHERE status IN (...)` de docs/08 (lo crea `add-recurrence-engine`). Benchmark con seed `large` + definiciones.
- **SM-07 subestima**: solo mide pagos vinculados; un pago recurrente nunca modelado no se ve. Se declara en la UI y en el exit criterion (pregunta 6).
- **Valoración con la tasa de hoy para pagos futuros**: un pago en USD de dentro de 60 días se valora con la tasa actual (es la mejor información disponible y lo que hace docs/14); la UI lo indica ("valorado con la tasa de hoy").

## Plan de migración

Sin migraciones. Despliegue: (1) contratos de Commitments/Transactions disponibles (dependencia), (2) API y consumidor con los eventos nuevos, (3) web. Rollback: la versión anterior ignora los endpoints; el Home vuelve a declarar Q4/Q8 no disponibles. OpenAPI MINOR (oasdiff sin cambios rompedores).

## Dependencias entre changes

- **Requiere aplicado:** `add-recurrence-engine` (contexto `@pf/commitments`, contratos de la tabla de arriba, eventos, `PendingFlowQuery` en Transactions). Va **después** de él en el orden de Phase 3.
- **Compatible con:** `add-subscriptions` (las suscripciones son definiciones administradas: aparecen en la lista sin cambios) y `add-commitment-matching` (un match automático resuelve la ocurrencia: sale de la lista; si el usuario lo confirma tarde, SM-07 lo cuenta según la decisión 10).
- **Existente:** `add-basic-dashboard` (resumen, `homeQuestions`, valoración), `add-financial-periods`, `add-net-worth-evolution` (patrón de tarjeta compacta + vista), `improve-event-throughput` (consumidor por lotes).
- **Phase 7:** el calendario completo amplía esta capability (FR-REPORTING-014/015, NFR-PERF-010) y puede reemplazar la lectura directa por la proyección `reporting.commitment_occurrence`.

## Preguntas abiertas

1. **Lectura directa o read model.** El pedido inicial hablaba de "leer el read model desde eventos de commitments". ¿Se acepta leer los contratos de Commitments en la transacción de lectura (decisión 1) y dejar la proyección `reporting.commitment_occurrence` para Phase 7?
   - a) **Lectura directa + eventos solo para la versión de datos** (recomendada: read-your-writes, cero tablas, volumen pequeño, mismo patrón que el Home de Phase 1/2).
   - b) Proyección en Reporting alimentada por eventos (lag visible tras aprobar/omitir; rebuild y export propios).
   **Recomendación: a.** No bloquea el orden; sí la forma del adapter.
2. **¿Quién une ocurrencias y pendientes?** (coordinación con `add-recurrence-engine`, **bloquea** la implementación de la decisión 3)
   - a) **Commitments expone la lista unificada y el total del periodo en montos nativos; Reporting valora y presenta** (recomendada: una sola regla de deduplicación y de FR-COMMITMENTS-011; Commitments no depende de FX).
   - b) Commitments expone solo ocurrencias y Reporting une con las pendientes (regla duplicada si `GET W/recurring/committed` también suma pendientes).
   - c) Commitments consolida también en moneda base (necesita FX y `FlowValuation`; dos lugares que valoran).
   **Recomendación: a.**
3. **Compromisos en el plan mensual (FR-PLANNING-008 "compromisos esperados").** ¿Los compromisos aparecen en el plan del periodo?
   - a) **Sección de solo lectura "Comprometido del periodo" en la pantalla del plan, por categoría (comprometido vs restante de la línea), sin crear líneas ni cambiar el gastado, los umbrales ni el "disponible para gastar"** (recomendada; change pequeño de `planning/budgets` después de `add-recurrence-engine`, Planning lee `CommittedQuery`).
   - b) Generar líneas `FIXED` del plan desde las definiciones (duplica datos; conflicto con templates y con la propagación D85/D86).
   - c) Nada en Phase 3; esperar a safe to spend (Phase 4/7).
   **Recomendación: a**, fuera de este change. No bloquea.
4. **Vencidos de periodos anteriores en Q4.** FR-COMMITMENTS-011 habla del "total comprometido del periodo". ¿Una ocurrencia de septiembre aún sin resolver suma en el total de octubre?
   - a) **No suma; se muestra aparte "vencido de periodos anteriores"** (recomendada, decisión 8: el total del periodo es estable y lo vencido no se esconde).
   - b) Suma al total del periodo vigente (lo que "sigue debiendo").
   **Recomendación: a.** Coordinar con `add-recurrence-engine` para que `CommittedQuery` devuelva `overdueBefore`.
5. **Saldo proyectado (FR-LEDGER-013) en Phase 3.** docs/01 lo ubica en Phase 7. ¿Se adelanta en este change?
   - a) **Sí, por cuenta y sin consolidar** (recomendada: trivial, misma capability, responde "con saldo esperado" de Q8 sin el calendario).
   - b) Mantenerlo en Phase 7.
   **Recomendación: a** (docs/01 cambia la fase de FR-LEDGER-013 a 3).
6. **Medición de SM-07.** ¿Se acepta la definición de la decisión 10 (ocurrencia generada el mismo día del pago o después) como medida del exit criterion "0 pagos recurrentes sorpresa en un mes"? ¿Se agrega además al reporte de cierre de mes?
   - a) **Definición de la decisión 10, visible en `/pagos-proximos` y medida sobre un periodo cerrado del owner; el reporte de cierre la incorpora en un change posterior** (recomendada).
   - b) Marca manual "pago sorpresa" del usuario sobre una transacción (subjetiva, olvidable).
   - c) Heurística sobre transacciones no vinculadas que se parecen a una definición (depende de matching, Phase 6+).
   **Recomendación: a.** Prioridad Should; no bloquea.
7. **Ventana por defecto de la tarjeta Q8.** ¿7 días (docs/28 §3 "Vencen pronto (7 días)") o hasta el próximo ingreso esperado (docs/14 §4.2)?
   - a) **7 días fijos en Phase 3** (recomendada; el horizonte "hasta el próximo cobro" llega con safe to spend).
   - b) Hasta el próximo ingreso esperado, con 30 días si no hay.
   **Recomendación: a.**

## Cambios a docs compartidos

No se editan en este hilo; para la consolidación:

- **docs/01:** FR-LEDGER-013 pasa de Phase 7 a Phase 3 si se acepta la pregunta 5; FR-REPORTING-016 sin cambios; nota en FR-REPORTING-014/015 "Phase 7, la versión simple de Phase 3 la cubre `add-upcoming-payments`".
- **docs/03 §7:** agregar `add-upcoming-payments` al orden de Phase 3, después de `add-recurrence-engine` (y de `add-subscriptions` si se quiere ver las suscripciones en las pruebas E2E).
- **docs/10:** `GET W/reports/upcoming-payments` y `GET W/reports/surprise-payments` (VIEWER) en la sección de Reporting; `actionHint: CREATE_COMMITMENT`.
- **docs/11:** consumidor `reporting.data-version` suma los eventos de Commitments listados.
- **docs/14:** §2.2 fila "Próximos pagos / comprometido (Phase 3): contratos de Commitments directo"; §3 valoración de `Upcoming commitments` como `FlowValuation` con fecha hoy (as-built); §9.1 Q4/Q8 disponibles en Phase 3 (versión simple) con SM-07.
- **docs/28 §3:** tarjetas Q4/Q8 y vista `/pagos-proximos`.
- **docs/24 §5.3:** exit criterion SM-07 medido con el indicador (pregunta 6).
- **ARCHITECTURE §14:** `reporting/cash-flow-calendar` ya listada; marcar "versión simple en Phase 3".
- **`reporting/dashboard` (spec vigente) + TC-REPORTING-DASHBOARD-005:** delta MODIFIED del requirement "Preguntas del Home sin datos o no disponibles" para que el scenario de Phase 1 "Pagos próximos aún no disponibles" pase a cubrir solo las preguntas aún no habilitadas (metas, Q9) y Q4/Q8 remitan a esta capability; actualizar TC-REPORTING-DASHBOARD-005 en el mismo commit (está `confirmed`; si se cambia el nombre del scenario sin actualizar el TC, `traceability:check` falla).
- **contracts/openapi/finance-api.v1.yaml:** operaciones y esquemas de § Contratos.
