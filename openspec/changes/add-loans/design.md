# Diseño

## Contexto

DEBT (core, schema `debt`, `@pf/debt`; docs/05 §2.9, docs/04 §3.9 y §4.6) no existe todavía en el código: `packages/contexts/` tiene accounts, audit, classification, commitments, fx, identity, imports, ledger, notifications, planning, reporting y transactions. Este change crea el contexto (si `add-credit-cards` no lo creó antes; ver § Dependencias con otros changes de Phase 4) con su parte de préstamos: el AR **`Loan`**, el cálculo del cronograma francés (capability `debt/amortization`) y la integración con TRANSACTIONS (desembolso y pago), ACCOUNTS (cuenta `LOAN`), LEDGER (saldo de la cuenta) y COMMITMENTS (cuotas como compromisos). Motivación: proposal.md — Why.

Lo que ya existe y se reutiliza (verificado en el código):

- **Cuentas de pasivo.** `accounts.account.type = 'LOAN'` con `classification = 'LIABILITY'` derivada (CHECK de coherencia tipo↔naturaleza, docs/08 §5.3; `AccountTypeDto` en `@pf/accounts/contracts`). El saldo de un pasivo se presenta positivo (adeudado) y en el ledger es negativo (docs/09 §6.7). La apertura con saldo inicial ya postea `OPENING` contra `EQUITY:OPENING_BALANCE:<CCY>` en la UoW de `OpenAccount` (`AccountOpeningBalancePort`, adaptador `apps/api/src/accounts/open-account-with-opening-balance.ts`).
- **Transferencias.** Una transferencia es una `Transaction` `kind = TRANSFER` con patas `SOURCE`/`TARGET` (`txn.transaction_leg.role IN ('MAIN','SOURCE','TARGET','FEE')`) y splits solo para comisiones (categoría de sistema `FEES`); el pago de tarjeta es una transferencia ASSET→LIABILITY (D27, spec `transactions/transfers` "Pago de tarjeta de crédito como transferencia").
- **Kinds de transacción.** El dominio (`TRANSACTION_KINDS` en `packages/contexts/transactions/src/domain/transaction.ts`) y el CHECK de `txn.transaction.kind` admiten hoy `INCOME, EXPENSE, REFUND, ADJUSTMENT, TRANSFER, CONVERSION`; el OpenAPI (`TransactionKind`) ya reserva `OPENING_BALANCE, LOAN_DISBURSEMENT, LOAN_PAYMENT` ("produced by Debt (Phase 4)"), y `TRANSACTION_SOURCES` ya incluye `DEBT`.
- **Categorías de sistema.** `INTEREST` (Intereses pagados), `LOAN_FEES` (Comisiones de préstamo), `INSURANCE` (Seguros), `TAXES` (Impuestos) ya están provisionadas (`packages/contexts/classification/src/domain/system-categories.ts`).
- **Compromisos.** `RESERVED_RECURRING_KINDS = ['LOAN_PAYMENT','CARD_PAYMENT']` (rechazo `RECURRING_KIND_NOT_AVAILABLE`, D116), `MANAGED_BY = ['USER','SUBSCRIPTION','DEBT']` y el tipo público **reservado** `RecurringDefinitionPort.createManaged` en `@pf/commitments/contracts` ("Reservado para Debt (`DEBT`) … sigue sin implementación"). Las suscripciones usan un `ManagedDefinitionPort` interno; Debt, al ser otro contexto, necesita el puerto **público**.
- **Asiento de referencia.** docs/09 §6.9 (desembolso con comisión retenida y pago con cinco componentes) y §12 (HALF_EVEN, ejemplo francés 1000.00/3/1 % = 340.02, 340.02, 340.03).

Reglas que se respetan: dinero `Decimal` con moneda (INV-001/002, ADR-0006); cuadre por moneda (INV-004); HALF_EVEN solo en materialización y producto exacto con un solo redondeo (docs/09 §12, SPIKE-03); INV-016 (Σ componentes = pago), INV-017 (Σ principal = principal), INV-030 (préstamo sobre LIABILITY); contextos que no se importan entre sí (puertos en `contracts`, eventos por outbox); auditoría en la misma UoW (INV-029); RLS por workspace (INV-025); migraciones expand; OpenAPI aditivo; "hoy" en la zona del workspace y periodos financieros (planning/financial-periods).

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| DEBT (nuevo) | AR `Loan`, entidades `ScheduleVersion`, `LoanInstallment`, `LoanPayment`, `ReferenceSchedule`, `ScheduleComparison`; DS `AmortizationCalculator`, `PaymentAllocator`, `ScheduleComparator`; `LoanStateMachine` | domain | nuevo |
| DEBT | `RegisterLoan`, `RegisterExistingLoan`, `DisburseLoan`, `RecordLoanPayment`, `VoidLoanPayment`, `CancelLoan`, `UpdateLoanDetails`, `UploadReferenceSchedule`, `CompareSchedule`, `ExplainComparison`; queries `GetLoan`, `ListLoans`, `GetAmortizationSchedule`, `PreviewSchedule`, `ListLoanPayments`, `GetComparison` | application | nuevo |
| DEBT | repos Kysely, adapters de puertos, módulo Nest, controller `loans` | infrastructure / interface | nuevo |
| TRANSACTIONS | kinds `LOAN_DISBURSEMENT`, `LOAN_PAYMENT`; VO `LoanPaymentBreakdown`; puerto público `LoanTransactionsPort`; guarda `TRANSACTION_MANAGED_EXTERNALLY`; flujos nominales que incluyen los splits de préstamo | domain / application / contracts | extensión |
| ACCOUNTS | puerto público `AccountProvisioningPort` (abrir una cuenta `LOAN` en la UoW del llamador, con saldo inicial opcional) | contracts / application | extensión |
| COMMITMENTS | implementación de `RecurringDefinitionPort` para `managedBy = DEBT` con calendario explícito; `LOAN_PAYMENT` habilitado solo para `DEBT`; comprometido y próximos pagos con `LOAN_PAYMENT` | domain / application / contracts | extensión |
| AUDIT | máquina `Loan` registrada en `audit/lifecycle-timeline` (Should) | application | extensión |
| `apps/api`, `apps/web` | composición de puertos, endpoints, pantalla Deudas → Préstamo | interface | nuevo |

## Objetivos / No objetivos

**Objetivos:**
- El owner registra sus préstamos reales (nuevos o en curso) y su cronograma francés **coincide al centavo** con la tabla del banco, o la diferencia queda **explicada** con evidencia (exit criterion docs/24 §5.4).
- Σ principal de las cuotas = principal, exacto, probado con PBT (INV-017, RISK-001).
- El pago separa principal (reduce la deuda, no es gasto) de interés/comisiones/seguro/impuestos (gasto) en una sola transacción balanceada (INV-016).
- Las cuotas aparecen en Q4 (comprometido) y Q8 (próximos pagos) sin doble conteo.

**No objetivos:**
- Sistemas alemán, capital fijo y cronograma custom; pagos extraordinarios con recálculo; tasa variable con cambios de tasa; payoff simulator (`add-loan-amortization-advanced`).
- Tarjetas de crédito y resumen de deudas (`add-credit-cards`, change de resumen de deudas del otro agente; FR-DEBT-012..018).
- Morosidad como estado (`delinquent`), `LoanInstallmentOverdue`, avisos de cuota vencida, refinanciación (`refinanced`), períodos de gracia, interés capitalizado, préstamos en moneda distinta de la cuenta de pago (pregunta 5), préstamos otorgados por el usuario (cuentas por cobrar).
- Reporte "Debt Evolution" y `debt_snapshot` de Reporting (docs/14 #10; Phase 7) y DTI.

## Decisiones

1. **Contexto `@pf/debt` y schema `debt`.** Paquete `packages/contexts/debt` con la estructura de los demás (`domain`, `application`, `contracts`, `infrastructure`, `interface`) y test de arquitectura (no importa capas internas de otros contextos). Si `add-credit-cards` se implementa antes, este change solo agrega sus tablas y módulos; el primero que se aplique crea el schema, el rol de grants y el registro en `platform.workspace_scoped_table`.

2. **AR `Loan`.** Atributos: `id, workspaceId, name, accountId (LOAN), disbursementAccountId, paymentAccountId, lenderCounterpartyId?, principal: Money, annualRate (Decimal, fracción con 18 decimales: 0.115 = 11.50 %), rateType (FIXED|VARIABLE), dayCount (D30_360|ACT_360|ACT_365), frequency (MONTHLY|BIMONTHLY|QUARTERLY|SEMIANNUAL|ANNUAL), termInstallments (1–600), method (FRENCH; GERMAN|FIXED_PRINCIPAL|CUSTOM reservados ⇒ LOAN_METHOD_NOT_AVAILABLE), disbursementDate, firstDueDate, charges: {fees, insurance, taxes} cada uno {mode: FIXED|RATE_ON_BALANCE, value}, origin (NEW|EXISTING), existing?: {asOf, outstanding, nextInstallmentNo}, status, currentScheduleVersion, recurringDefinitionId?, disbursementTransactionId?, version`. Estados `DRAFT → ACTIVE → PAID_OFF`, `DRAFT|ACTIVE → CANCELLED` (docs/04 §4.6 sin `delinquent` ni `refinanced`, que quedan fuera): `LoanStateMachine` con el `lifecycle-machine` del shared-kernel (D37), una transición por comando (`REGISTER`, `DISBURSE`, `REGISTER_EXISTING` ∅→`ACTIVE`, `PAY_OFF`, `REACTIVATE` por anulación del pago que saldó, `CANCEL`). `LOAN_TERMS_LOCKED` para editar condiciones de un préstamo no `DRAFT`; en `DRAFT` se editan libremente (se recalcula la vista previa).

3. **`AmortizationCalculator` (puro, TDD, PBT).** Entrada: principal (o saldo pendiente), tasa, convención, periodicidad, plazo, fecha de inicio de devengo (desembolso o `asOf`), primera cuota, cargos, escala de la moneda. Salida: cuotas `{n, dueDate, periodStart, periodEnd, principal, interest, fees, insurance, taxes, total, openingBalance, closingBalance}`.
   - **Cuota francesa:** `A = HALF_EVEN(P·i / (1 − (1+i)^−n))` con `i = annualRate / cuotasPorAño`; con `annualRate = 0`, `A = HALF_EVEN(P/n)`. La potencia se calcula con `Decimal` precisión 40 (exponente entero; sin `Math.pow`).
   - **Interés de la cuota k:** `HALF_EVEN(saldo_{k−1} × annualRate × fracción)` con `fracción = días30360/360` (método 30/360 europeo: días 31 → 30; para periodos regulares da exactamente `1/cuotasPorAño`), `díasReales/360` (ACT/360) o `díasReales/365` (ACT/365). Un solo redondeo por componente (producto exacto, SPIKE-03).
   - **Principal:** `A − interés`; **última cuota:** principal = saldo restante (absorbe el residuo, INV-017) y total = principal + interés + cargos. Si en una cuota intermedia `A − interés < 0` (tasa muy alta con periodo irregular), el cálculo se rechaza con `VALIDATION_FAILED` (`details.reason = NEGATIVE_AMORTIZATION`): no se modela la amortización negativa.
   - **Fechas:** `firstDueDate + k·(12/cuotasPorAño)` meses conservando el día; día inexistente ⇒ último día del mes (mismo criterio que el motor de recurrencia, `LocalDate` del shared-kernel). Sin ajuste por fin de semana (pregunta 8).
   - **ACT/360, ACT/365 y primer periodo irregular:** con la cuota de la fórmula, el residuo de la última cuota puede ser grande (cálculo de referencia: 50000.00 BOB, 11.50 %, 24 cuotas, ACT/360 ⇒ cuota 2342.02 y **última 2447.38**; con primer periodo de 44 días 30/360 ⇒ última 2620.36). Muchos bancos "nivelan" la cuota. Se deja como **pregunta 1 [B]**; la recomendación (cuota nivelada: la menor cuota en centavos que minimiza |última − cuota|, p. ej. 2345.94 con última 2345.90 en el caso ACT/360) se implementa detrás de un único punto del calculador (`levelInstallment`), sin afectar 30/360 regular.
   - **Cargos:** `FIXED` = monto por cuota; `RATE_ON_BALANCE` = `HALF_EVEN(saldo_{k−1} × tasaMensual × meses del periodo)`; nunca alteran principal ni interés.
   - **Préstamo en curso:** el mismo cálculo con `P = outstanding`, devengo desde `asOf`, `n = cuotas restantes` y numeración desde `nextInstallmentNo` (Σ principal = saldo pendiente).
   - PBT (fast-check, ≥ 1 000 casos en CI, 100 000 nightly; RISK-001): Σ principal = P; componentes ≥ 0; total = Σ componentes; saldo final 0; determinismo (mismo input ⇒ mismo output); escala BOB (2) y USDT (6).

4. **Cronograma versionado.** `debt.loan_schedule_version` (append-only) + `debt.loan_installment` con `UNIQUE (loan_id, schedule_version, installment_no)` (docs/08 §5.9). Este change solo crea la versión 1 (al desembolsar o al registrar el préstamo en curso); `add-loan-amortization-advanced` agrega versiones. Las cuotas de una versión **nunca** se reescriben: el estado de pago **no** vive en la cuota sino en las imputaciones (`loan_payment_allocation`), de modo que la versión es inmutable y el estado (`UNPAID|PARTIALLY_PAID|PAID`) se deriva de Σ imputaciones vigentes. `DUE` y `OVERDUE` también se derivan (vencimiento vs hoy en la TZ del workspace), sin job (docs/08 los listaba como estados almacenados: ver § Cambios a docs compartidos). La vista previa (`PreviewSchedule`) usa el mismo calculador sin persistir.

5. **Desembolso (`DisburseLoan`).** En una UoW: `assertCanPost` de las cuentas, `LoanTransactionsPort.recordDisbursement` (Transactions crea la `Transaction` `kind = LOAN_DISBURSEMENT`, `source = DEBT`, `externalRef = {debt.loan, loanId}`, patas `TARGET` = cuenta destino `+(principal − comisión)` y `SOURCE` = cuenta del préstamo `−principal`, y si hay comisión retenida un split `LOAN_FEES` por la comisión con pata `FEE` de gasto; asiento `EXPENSE:<CCY>` + ASSET + LIABILITY, docs/09 §6.9), versión 1 del cronograma, `createManaged` de la definición de cuotas (decisión 9), transición `DISBURSE`, auditoría y outbox (`LoanDisbursed.v1`, `LoanScheduleGenerated.v1`). Los errores de Transactions/Ledger (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`, `CURRENCY_MISMATCH`) abortan todo. `RegisterLoan` con `disburseNow: true` hace registro y desembolso en la misma UoW (atajo de la UI).

6. **Préstamo en curso (`RegisterExistingLoan`).** Sin transacción de desembolso (`disbursementTransactionId = null`). Si se pide crear la cuenta, `AccountProvisioningPort.openAccount({type: LOAN, openingBalance: outstanding, openingDate: asOf})` (reutiliza el asiento `OPENING` existente); si la cuenta existe, `AccountBalancesQuery` al `asOf` debe ser igual a `outstanding` (`LOAN_BALANCE_MISMATCH`, `details: {accountBalance, declared}`). Estado inicial `ACTIVE` (transición `REGISTER_EXISTING`). Los pagos previos al `asOf` no se modelan.

7. **Cuenta creada en el acto.** `AccountProvisioningPort` (nuevo, `@pf/accounts/contracts`) abre una cuenta en la UoW del llamador con las mismas validaciones y auditoría que `OpenAccount` (nombre único, moneda habilitada) y devuelve su id; lo implementa ACCOUNTS (no el composition root) porque es su agregado. Alternativa descartada: obligar a crear la cuenta antes (dos pasos no atómicos; un borrador huérfano si falla el segundo). Ver pregunta 4.

8. **Pagos (`RecordLoanPayment`).** Entrada: `amount`, `businessDate`, `accountId` (por omisión la cuenta de pago del préstamo), `paymentMethod?`, `installmentNo?` + `breakdown?`. `PaymentAllocator` (puro, TDD):
   - **Sin desglose:** recorre las cuotas de la versión vigente con pendiente > 0 en orden de `n` y, dentro de cada una, impuestos → seguro → comisiones → interés → principal (docs/04 §3.9; pregunta 3), hasta agotar el monto. Si el monto supera el pendiente total del préstamo ⇒ `LOAN_OVERPAYMENT`. Pagar por adelantado cuotas futuras es imputar sus componentes completos (incluido su interés): el recálculo por prepago es de `add-loan-amortization-advanced`.
   - **Con desglose** (una cuota, `installmentNo` obligatorio): Σ componentes = `amount` (`PAYMENT_BREAKDOWN_MISMATCH`, `details: {sum, amount}`); principal ≤ principal pendiente del préstamo (`LOAN_OVERPAYMENT`); los excedentes sobre lo esperado (interés moratorio, penalidades) quedan como diferencia positiva de esa cuota; la cuota queda `PAID` cuando Σ principal imputado ≥ principal esperado.
   - **Transacción:** `LoanTransactionsPort.recordPayment` crea `kind = LOAN_PAYMENT`, `source = DEBT`, `externalRef = {debt.loan-payment, paymentId}`, pata `SOURCE` = cuenta de pago `−amount`, pata `TARGET` = cuenta del préstamo `+principal` (omitida si el principal es 0, CHECK `posting_nonzero`), y un split por componente no nulo con la categoría de sistema por `systemCode` (`INTEREST`, `LOAN_FEES`, `INSURANCE`, `TAXES`); `Σ splits = amount − principal` (INV-021 ampliado a `LOAN_PAYMENT`, docs/08 §5.4 ya lo anticipa). Se guarda `LoanPaymentBreakdown` en la transacción (docs/04 §3.6).
   - **Persistencia en Debt:** `debt.loan_payment` (una fila por pago, `UNIQUE (transaction_id)`, `status ACTIVE|VOIDED`) y `debt.loan_payment_allocation` (por cuota y componente). Bloqueo `FOR UPDATE` del préstamo durante el comando (dos pagos concurrentes se serializan).
   - **Anulación (`VoidLoanPayment`):** solo el pago `ACTIVE` más reciente (`LOAN_PAYMENT_NOT_LATEST`), así la imputación de los demás no cambia; `LoanTransactionsPort.voidManaged` (reversa del asiento), `status = VOIDED`, restitución de ocurrencias (decisión 9) y, si el préstamo estaba `PAID_OFF`, transición `REACTIVATE`.

9. **Cuotas como compromisos (FR-DEBT-011).** Al activarse el préstamo, `RecurringDefinitionPort.createManaged({managedBy: DEBT, managedRef: loanId, kind: LOAN_PAYMENT, template: {accountId: paymentAccountId, counterpartyId: lender}, explicitSchedule: [{key: n, dueDate, amount: total}], materialization: NOTIFY_ONLY})`. El motor genera una ocurrencia por ítem dentro del horizonte (90 días, D125) con monto `FIXED` = total de la cuota y nunca crea transacciones (modo solo aviso; D114: no entra en la bandeja de aprobación). Debt resuelve las ocurrencias: `settle(definitionId, keys[], transactionId)` cuando una cuota queda `PAID` (genera la ocurrencia si aún no está dentro del horizonte; varias claves con una transacción), `setExpected(definitionId, key, amount)` tras un pago parcial, `unsettle(...)` al anular, `end(definitionId, from)` al saldar o cancelar. Ver § Dependencias con el motor de recurrencia (N1–N9). Alternativa descartada: definición mensual con monto `ESTIMATED` y edición de ocurrencias desde Debt (las ocurrencias se generan perezosamente hasta el horizonte, la última cuota y los cargos sobre saldo varían; Debt tendría que vigilar cada generación).

10. **Transacciones administradas.** Transactions marca `LOAN_DISBURSEMENT` y `LOAN_PAYMENT` como **administradas** (`source = DEBT`): `RecordTransaction` rechaza esos kinds (`VALIDATION_FAILED`); `AmendTransaction` financiero y `VoidTransaction` desde la API de transacciones ⇒ `TRANSACTION_MANAGED_EXTERNALLY` (409, `details: {managedBy: DEBT, loanId}`); descripción, notas y tags siguen editables. Conciliación (`CLEAR`, reconciliar) aplica normal. Esto mantiene INV-016 sincrónico (la imputación y la transacción nunca divergen) sin que Debt consuma `TransactionVoided` (docs/05 §2.9 lo listaba; ya no hace falta para préstamos).

11. **Detalle (`GetLoan`).** Principal pendiente (cronograma) = principal (o saldo inicial) − Σ principal imputado vigente; saldo adeudado (cuenta) = `AccountBalancesQuery` de la cuenta `LOAN`; `unreconciledDifference` = diferencia entre ambos (transferencias manuales a la cuenta del préstamo, ajustes; pregunta 6). Próxima cuota = primera no pagada; atrasadas = no pagadas con vencimiento < hoy (TZ del workspace). Acumulados de interés/comisiones/seguro/impuestos = Σ imputaciones vigentes.

12. **Tabla del banco y comparación (exit criterion).**
    - **Carga (`UploadReferenceSchedule`):** CSV (≤ 256 KiB, ≤ 600 filas), texto pegado (TSV/`;`/`,` detectado y confirmado) o filas manuales. Mapeo explícito de columnas, formato de fecha (`dd/mm/aaaa`, `aaaa-mm-dd`, `mm/dd/aaaa`) y separador decimal (`,`/`.`) como en `imports/import-pipeline` (mismas reglas de lectura, sin pasar por el pipeline de transacciones). El parser vive en Debt (`ReferenceScheduleParser`, puro) reutilizando los helpers de lectura delimitada del shared-kernel/imports si están en un paquete compartido; si no, se extraen a `@pf/shared-kernel` (tarea 2.7). Validación por fila (montos ≥ 0, escala, total = Σ componentes si el total está mapeado; error con número de fila). Se guarda `debt.loan_reference_schedule` (versión por préstamo, append-only) + filas; el contenido original del archivo **no** se guarda (solo las filas parseadas; datos del banco del owner, repositorio público ⇒ nada de esto en fixtures).
    - **Comparación (`ScheduleComparator`, puro):** empareja por número de cuota; por fila: fechas iguales, diferencias por componente (banco − sistema), `MATCH` si todo coincide al centavo; resumen: coincidentes/total, primera diferencia, Σ diferencias por componente, Σ principal de la referencia vs principal, filas huérfanas. Se persiste `debt.loan_schedule_comparison` (referencia vN × cronograma vM, resultado y estado `MATCH|UNEXPLAINED|EXPLAINED`) para que el exit criterion quede registrado. Export CSV síncrono.
    - **Sugerencias (Should):** recalcula con las otras convenciones (y, si se aprueba la pregunta 1, con cuota nivelada) y reporta coincidencias por variante; heurísticas: solo fechas, solo cargos, solo última cuota (|Δ| ≤ 0.01 × n), Σ principal distinto. Nunca cambia el préstamo.
    - **Explicación (`ExplainComparison`):** texto (≤ 1 000 caracteres) + autor + fecha; estado `EXPLAINED`.
    - **Procedimiento del exit criterion:** el owner carga la tabla real de su banco (fuera del repositorio), compara, y el resultado `MATCH` o `EXPLAINED` se anota en el informe de cierre de la fase (sin cifras personales en el repo). Pregunta 2 [B].

13. **Eventos** (outbox, misma UoW; esquemas en `contracts/events/debt/`): `debt.LoanDisbursed.v1`, `debt.LoanScheduleGenerated.v1` (payload de docs/11 + `reason: INITIAL`), `debt.LoanPaymentRecorded.v1` (docs/11 + `paymentId`), `debt.LoanPaymentVoided.v1` (**nuevo**), `debt.LoanPaidOff.v1`. Sin consumidores obligatorios en este change (Reporting Phase 7; NOTIFY no avisa cuotas: el aviso de próximo pago ya lo da el motor con `RecurringOccurrenceDue.v1`, que incluye `managedBy`, D119).

14. **Autorización, idempotencia, auditoría.** Lectura VIEWER+; escritura EDITOR/OWNER (`INSUFFICIENT_ROLE`). `POST` de creación, desembolso y pago con `Idempotency-Key`; `PATCH`, anulación y cancelación con `If-Match`. Auditoría `debt.loan.*` con la allow-list `DEBT_AUDIT_POLICY` (montos `money`, nombres `plain`, explicaciones `plain`), misma UoW.

15. **Recorrido (Should).** Máquina `Loan` registrada en `audit/lifecycle-timeline` (`GET …/loans/{id}/lifecycle`, export CSV/PDF existentes); pagos y anulaciones como anotaciones (D37, D52).

16. **Portabilidad y demo.** Tablas nuevas en `@pf/debt/contracts/portability.ts` (después de accounts, transactions y commitments; remapeo de `account_id`, `transaction_id`, `recurring_definition_id`) y en `platform.workspace_scoped_table`. Demo (docs/29): un préstamo vehicular con 3 cuotas pagadas (Could, tarea 8.3).

17. **Zona horaria y periodos.** Fechas de negocio `date`; "hoy" = `Clock` + `WorkspaceCalendarQuery.timeZone`. Las cuotas no se cortan por periodo financiero; el comprometido del periodo las toma por vencimiento (regla del motor). Un pago con fecha en periodo cerrado falla con `PERIOD_CLOSED` (Ledger).

### Modelo de datos (expand-only)

| Tabla | Columnas clave | Restricciones | RLS |
|---|---|---|---|
| `debt.loan` | `id, workspace_id, name, account_id, disbursement_account_id, payment_account_id, lender_counterparty_id, principal numeric(38,18), currency, annual_rate numeric(38,18), rate_type, day_count, frequency, term_installments, method, disbursement_date, first_due_date, charges jsonb, origin, existing_as_of, existing_outstanding, next_installment_no, status, current_schedule_version, recurring_definition_id, disbursement_transaction_id, version, created_at, updated_at` | `UNIQUE (workspace_id, account_id) WHERE status <> 'CANCELLED'`; `principal > 0`; `annual_rate >= 0`; `term_installments BETWEEN 1 AND 600`; `first_due_date > disbursement_date`; `status IN ('DRAFT','ACTIVE','PAID_OFF','CANCELLED')`; `method IN ('FRENCH','GERMAN','FIXED_PRINCIPAL','CUSTOM')` | WS |
| `debt.loan_schedule_version` | `loan_id, schedule_version, reason, effective_from, parameters jsonb, created_at, created_by` | PK `(loan_id, schedule_version)`; append-only (`forbid_mutation`) | WS-RO |
| `debt.loan_installment` | `id, workspace_id, loan_id, schedule_version, installment_no, due_date, period_start, principal_amount, interest_amount, fees_amount, insurance_amount, tax_amount, total_amount, opening_balance, closing_balance, currency` | `UNIQUE (loan_id, schedule_version, installment_no)`; `total = Σ componentes`; componentes `>= 0`; append-only | WS-RO |
| `debt.loan_payment` | `id, workspace_id, loan_id, transaction_id, business_date, amount, principal, interest, fees, insurance, taxes, explicit_breakdown bool, status, voided_at, voided_reason, created_by` | `UNIQUE (transaction_id)`; `amount = Σ componentes` (INV-016) | WS |
| `debt.loan_payment_allocation` | `payment_id, installment_id, principal, interest, fees, insurance, taxes` | PK `(payment_id, installment_id)`; componentes `>= 0` | WS |
| `debt.loan_reference_schedule` | `id, workspace_id, loan_id, reference_version, source (CSV|PASTE|MANUAL), mapping jsonb, row_count, created_at, created_by` | `UNIQUE (loan_id, reference_version)`; append-only | WS-RO |
| `debt.loan_reference_row` | `reference_id, installment_no, due_date, principal, interest, fees, insurance, taxes, total, balance` | PK `(reference_id, installment_no)`; append-only | WS-RO |
| `debt.loan_schedule_comparison` | `id, workspace_id, loan_id, reference_id, schedule_version, matched, total_rows, first_difference_no, summary jsonb, status, explanation, explained_by, explained_at` | `UNIQUE (reference_id, schedule_version)`; `status IN ('MATCH','UNEXPLAINED','EXPLAINED')` | WS |

Expand de otros contextos: `txn.transaction.kind` CHECK + `LOAN_DISBURSEMENT`, `LOAN_PAYMENT`; `txn.transaction` columna `loan_payment_breakdown jsonb NULL`; `txn.assert_splits_sum()` ampliado a `LOAN_PAYMENT` (Σ splits = monto − principal) y `LOAN_DISBURSEMENT` (Σ splits = comisión); `commitments.recurring_definition`: CHECK `kind` admite `LOAN_PAYMENT` solo con `managed_by = 'DEBT'`, columna `explicit_schedule jsonb NULL` en la versión de definición (CHECK: regla XOR calendario explícito).

## Contratos

**API** (`contracts/openapi/finance-api.v1.yaml`, aditivo; docs/10 §13 fila `loans`):

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| Listar | `GET W/loans?status=` | VIEWER+ | resumen por préstamo: principal pendiente, próxima cuota, estado |
| Registrar | `POST W/loans` | EDITOR+ | `Idempotency-Key`; `origin: NEW\|EXISTING`; `account: {id} \| {create: {name, institutionId?}}`; `disburseNow?` |
| Detalle | `GET W/loans/{id}` | VIEWER+ | `ETag`; decisión 11 |
| Editar | `PATCH W/loans/{id}` | EDITOR+ | `If-Match`; en `DRAFT` todo; en `ACTIVE` solo nombre, prestamista y cuenta de pago (`LOAN_TERMS_LOCKED`) |
| Vista previa | `POST W/loans/schedule-preview` | VIEWER+ | sin efectos |
| Desembolsar | `POST W/loans/{id}/disburse` | EDITOR+ | `Idempotency-Key`; `{retainedFee?}` |
| Cancelar | `POST W/loans/{id}/cancel` | EDITOR+ | `If-Match`; `{reason}` |
| Cronograma | `GET W/loans/{id}/installments?version=` | VIEWER+ | por omisión la versión vigente, con estado derivado y esperado/pagado/diferencia por componente |
| Pagos | `GET W/loans/{id}/payments`, `POST W/loans/{id}/payments`, `POST W/loans/{id}/payments/{paymentId}/void` | VIEWER+ / EDITOR+ | docs/10 tenía `POST …/installments/{n}/pay`: se reemplaza por `payments` porque un pago puede cubrir varias cuotas |
| Referencias | `POST W/loans/{id}/reference-schedules` (multipart o JSON), `GET …/reference-schedules` | EDITOR+ / VIEWER+ | límites decisión 12 |
| Comparación | `GET W/loans/{id}/reference-schedules/{refId}/comparison`, `GET …/comparison.csv`, `POST …/comparison/explanation` | VIEWER+ / EDITOR+ | |
| Recorrido | `GET W/loans/{id}/lifecycle` | VIEWER+ | Should |

`TransactionKind` ya incluye `LOAN_DISBURSEMENT`, `LOAN_PAYMENT` (se quita la nota "Phase 4"); `Transaction` gana `loanPaymentBreakdown` y `loanId` opcionales. `RecurringKind`: `LOAN_PAYMENT` sale de `x-reserved` para lectura (aparece en definiciones y ocurrencias administradas) y sigue rechazado en `POST/PATCH W/recurring-definitions`.

**Códigos nuevos (`ErrorCode`, `x-extensible-enum`):** `LOAN_METHOD_NOT_AVAILABLE` (422), `LOAN_ACCOUNT_INVALID` (422), `LOAN_ACCOUNT_IN_USE` (409), `LOAN_ACCOUNT_NOT_EMPTY` (409), `LOAN_BALANCE_MISMATCH` (422), `LOAN_NOT_DRAFT` (409), `LOAN_NOT_ACTIVE` (409), `LOAN_TERMS_LOCKED` (409), `LOAN_OVERPAYMENT` (422), `LOAN_PAYMENT_NOT_LATEST` (409), `LOAN_HAS_PAYMENTS` (409), `TRANSACTION_MANAGED_EXTERNALLY` (409), `LOAN_REFERENCE_INVALID` (422, `details.rows[]`). `PAYMENT_BREAKDOWN_MISMATCH` (422) ya estaba previsto en docs/10 §9.1; `INSTALLMENT_ALREADY_PAID` (docs/10) no se usa (un pago imputa a la siguiente no pagada).

**Eventos** (`contracts/events/debt/*.v1.schema.json`, clave de idempotencia):
- `debt.LoanDisbursed.v1` — `loanId, accountId, disbursementAccountId, transactionId, principal: Money, retainedFee: Money, disbursedOn` — `(loanId)`.
- `debt.LoanScheduleGenerated.v1` — `loanId, scheduleVersion, reason: INITIAL, effectiveFrom, installments: [{n, dueDate, principal, interest, fees, insurance, taxes, total}]` — `(loanId, scheduleVersion)`.
- `debt.LoanPaymentRecorded.v1` — `loanId, paymentId, transactionId, installmentNos[], breakdown{principal, interest, fees, insurance, taxes, total}, remainingPrincipal, paidOn` — `(loanId, transactionId)`.
- `debt.LoanPaymentVoided.v1` (**nuevo**) — `loanId, paymentId, transactionId, installmentNos[], remainingPrincipal` — `(loanId, paymentId, 'VOIDED')`.
- `debt.LoanPaidOff.v1` — `loanId, paidOffOn, lastTransactionId` — `(loanId, aggregateVersion)`.

**Puertos públicos nuevos o ampliados:**
- `@pf/transactions/contracts` → `LoanTransactionsPort { recordDisbursement, recordPayment, voidManaged }` (UoW del llamador; errores sin traducir). `LOAN_TRANSACTIONS_PORT`.
- `@pf/accounts/contracts` → `AccountProvisioningPort.openAccount({workspaceId, userId, type, name, currency, institutionId?, openingBalance?, openingDate?})`.
- `@pf/commitments/contracts` → `RecurringDefinitionPort` (hoy reservado) con `createManaged`, `replaceSchedule` (para el change avanzado), `settle`, `unsettle`, `setExpected`, `end`; `RecurringKindDto` + `LOAN_PAYMENT`.
- `@pf/debt/contracts` → `DEBT_EVENTS`, `DEBT_AUDIT_POLICY` y `LoanPortfolioQuery` (insumo de `add-debt-summary` y del payoff simulator; pedidos L1–L2d de `add-debt-summary` aceptados):
  - `listLoans({workspaceId, statuses?})` (por omisión `ACTIVE` y `PAID_OFF` con saldo de cuenta ≠ 0) → por préstamo `loanId, name, accountId, currency, status, method, rateType, annualRate, outstandingPrincipal, accountBalance, unreconciledDifference, installmentAmount` (cuota vigente), `nextInstallment {n, dueDate, outstanding, overdueDays}` (pendiente tras pagos parciales; días de atraso con hoy en la TZ del workspace), `lastUnpaidInstallmentDueDate`;
  - `interestPaid({workspaceId, from, to})` → `[{loanId, amount: Money}]` = Σ interés de imputaciones vigentes con fecha de pago en el rango (las anuladas no cuentan).

## Dependencias con el motor de recurrencia

| # | Necesidad | Estado hoy | Qué hace este change |
|---|---|---|---|
| N1 | `RecurringDefinitionPort.createManaged` público en la UoW del llamador con `managedBy = DEBT` | Tipo reservado sin implementación | Lo implementa en COMMITMENTS sobre `DefinitionsService` (como `EngineManagedDefinitions` de suscripciones) |
| N2 | `kind = LOAN_PAYMENT` solo para `managedBy = DEBT`; API de usuario sigue en `RECURRING_KIND_NOT_AVAILABLE` | `RESERVED_RECURRING_KINDS` rechaza siempre | Excepción por administrador en la validación de dominio + CHECK |
| N3 | **Calendario explícito** (`explicitSchedule: [{key, dueDate, amount}]`) en lugar de regla, generado hasta el horizonte | No existe | `ScheduleSpec` gana la variante `EXPLICIT`; el generador recorre ítems en la ventana; clave de idempotencia = fecha nominal (INV-013) |
| N4 | Modo `NOTIFY_ONLY` forzado; aprobar/editar/omitir/vincular desde recurrentes ⇒ `RECURRING_MANAGED_EXTERNALLY` | Guarda existente para `SUBSCRIPTION` (pausar, revisar…) | Extiende la guarda a las acciones sobre ocurrencias cuando `kind = LOAN_PAYMENT` (no por `managedBy = DEBT`: las ocurrencias `CARD_PAYMENT` de `add-credit-cards` sí se operan desde recurrentes; acuerdo L3) |
| N5 | `settle(keys[], transactionId)`: una transacción resuelve varias ocurrencias de la misma definición; genera las fuera de horizonte | `TRANSACTION_ALREADY_LINKED` impide 1:N | Relaja la unicidad solo para ocurrencias `LOAN_PAYMENT` (índice único parcial por `kind`) |
| N6 | `setExpected(key, amount)` y `unsettle(keys[])` | "Editar una ocurrencia" y liberación existen como acciones de usuario/consumidor | Expone ambas por el puerto |
| N7 | El consumidor `commitments.transaction-voided` y el matcher (`commitments.occurrence-matcher`, `match-backfill`) ignoran ocurrencias de cuotas de préstamo | No filtran | Filtro por `kind <> 'LOAN_PAYMENT'` (las `CARD_PAYMENT` se sugieren y liberan como transferencias; acuerdo L5 con `add-credit-cards`) |
| N8 | Comprometido y próximos pagos incluyen `LOAN_PAYMENT` como egreso; `UpcomingPaymentDto.kind` + `LOAN_PAYMENT` | Solo `EXPENSE` y `TRANSFER` líquido→no líquido (D127) | `CommittedCalculator` y queries; `RecurringKindDto` aditivo |
| N9 | `end(from)` al saldar/cancelar | Existe "terminar" (N10 de suscripciones) | Lo expone por el puerto |

## Dependencias con otros changes de Phase 4

- **`add-credit-cards`** (otro agente): comparte el contexto `@pf/debt`, el schema `debt`, el módulo Nest, la allow-list de auditoría y `portability.ts` (orden: `loan*` y `credit_card*` después de `commitments`, acuerdo L6). El primero que se implemente crea el contexto (recomendado `add-loans`, L1). Un solo `RecurringDefinitionPort`: `add-credit-cards` le agrega `createManaged` con regla mensual y `kind = CARD_PAYMENT`, `revise`, `setExpected` con tipo, `skip` y `listOccurrences` (L2); el requirement "Resolución de cuotas por el contexto de deudas" de este change y "Monto esperado fijado por el administrador" de `add-credit-cards` se consolidan al archivar. Las guardas y filtros del motor se condicionan por `kind = LOAN_PAYMENT` (L3, L5). Ambos agregan códigos a `ErrorCode` (prefijos `LOAN_`/`CARD_`).
- **`add-debt-summary`** (FR-DEBT-018, TC-DEBT-SUMMARY): consume `LoanPortfolioQuery` con los campos pedidos (L1–L2d, aceptados en § Contratos). Este change no implementa el resumen.
- **`add-savings-goals`** (otro agente): Q5 usa el comprometido del periodo, que ya incluye las cuotas (N8). Comparte el puerto público `RecurringDefinitionPort` con `managedBy = GOAL` (su N5): el puerto se diseña genérico por `managedBy`, con las guardas y filtros específicos de cuotas atados a `kind = LOAN_PAYMENT`; quien implemente primero el puerto lo publica y los demás lo amplían de forma aditiva.
- **`add-loan-amortization-advanced`**: depende de este change (versiones de cronograma, `ScheduleComparator` y parser para el cronograma custom importado, `replaceSchedule` de N3).

## Riesgos / Trade-offs

- [Redondeo de cuotas (RISK-001)] → calculador puro con `Decimal` precisión 40, un solo redondeo por componente, PBT de INV-016/INV-017 y tabla de referencia de docs/09 §12 como test dorado.
- [El cronograma no coincide con el banco (exit criterion)] → convenciones configurables, reporte de diferencias con sugerencias y diferencia explicada; pregunta 1 y 2.
- [Sobre-modelar (RISK-005)] → sin `delinquent`, sin job de vencidas, sin refinanciación, estados de cuota derivados.
- [Divergencia préstamo ↔ cuenta del préstamo] → transacciones del préstamo administradas (decisión 10) y diferencia visible en el detalle (decisión 11).
- [Cambio en el motor de recurrencia (N3–N8) con regresiones en Q4/Q8] → cambios aditivos detrás de `managedBy = DEBT`; TC-COMMITMENTS-* y TC-REPORTING-UPCOMING-* deben seguir en verde.
- [Flujos nominales: los dashboards y presupuestos dejan de ver el interés si `pg-nominal-flows` filtra kinds] → la consulta incluye `LOAN_PAYMENT` y `LOAN_DISBURSEMENT` (sus splits son gasto); TC-DEBT-LOAN-019.
- [Datos del banco del owner en un repo público] → la tabla real nunca se versiona; los TC usan cifras sintéticas.
- [Pagos concurrentes] → `FOR UPDATE` del préstamo; idempotencia por clave.

## Plan de migración

Expand-only, sin datos que migrar: schema `debt` (`CREATE SCHEMA IF NOT EXISTS`), tablas de § Modelo de datos con RLS forzada y políticas WS, grants (`SELECT, INSERT` + `platform.forbid_mutation()` en las append-only), `platform.workspace_scoped_table`; en `txn`: CHECK de `kind` ampliado (drop/add del CHECK con `NOT VALID` + `VALIDATE`), columna nullable `loan_payment_breakdown`, función `assert_splits_sum()` reemplazada (`CREATE OR REPLACE`); en `commitments`: CHECK de `kind`/`managed_by`, columna nullable `explicit_schedule`, índice único parcial de vinculación (por `kind = 'LOAN_PAYMENT'`). Rollback: la app anterior ignora las columnas nuevas; no hay filas con los kinds nuevos hasta usar el feature.

**Dependencias con otros changes:** requiere aplicados `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-ledger-core`, `add-classification`, `add-recurrence-engine`, `add-subscriptions` (guarda `RECURRING_MANAGED_EXTERNALLY`), `add-commitment-matching`, `add-upcoming-payments`, `add-financial-periods`, `add-lifecycle-timeline`, `add-workspace-export`.

## Cambios a docs compartidos

- **docs/01 §10**: FR-DEBT-001 — agregar convención de días y cuenta de pago habitual; FR-DEBT-007 — "solo el pago más reciente se anula"; nota de que la comparación con la tabla del banco cubre el exit criterion.
- **docs/04 §3.9 y §4.6**: `Loan` con `dayCount`, `frequency`, `termInstallments` (no `termMonths`), `charges` con modo `FIXED|RATE_ON_BALANCE`, `origin`; método `FIXED_PRINCIPAL` (reemplaza `BULLET`, que FR-DEBT-004 no pide); entidades `LoanPayment`, `ReferenceSchedule`, `ScheduleComparison`; estados de cuota derivados; máquina sin `delinquent`/`refinanced` en Phase 4; puertos `LoanTransactionsPort`, `AccountProvisioningPort`, `RecurringDefinitionPort`.
- **docs/05 §2.9**: ya no consume `TransactionVoided` para préstamos (transacciones administradas); publica `LoanPaymentVoided`.
- **docs/06**: relación ACCOUNTS → DEBT (C/S, SYNC-TX: `AccountProvisioningPort`) y COMMITMENTS → DEBT (C/S, SYNC-TX: `RecurringDefinitionPort`).
- **docs/08 §5.9**: tablas de § Modelo de datos (reemplazan `loan.term_months`, `start_date`, `amortization_method` con `BULLET`, `loan_installment.status`/`paid_transaction_id` y `loan_schedule_change`); §5.4 kinds, `loan_payment_breakdown`, `assert_splits_sum`; §5.7 `explicit_schedule`.
- **docs/09 §6.9**: nota de que el pago puede omitir la pata de principal en cero; §15 INV-016/017 con TC-DEBT-AMORT/LOAN.
- **docs/10 §9.1 y §13**: códigos nuevos; fila `loans` con las operaciones de § Contratos (reemplaza `…/installments/{n}/pay` y `…/schedule-changes` en este change).
- **docs/11**: `LoanPaymentVoided.v1` nuevo; payloads ampliados (`paymentId`, `reason`); `LoanInstallmentOverdue` fuera de Phase 4.
- **docs/14**: Expenses ya incluye interés de préstamos (sin cambio); nota as-built de flujos nominales con `LOAN_*`.
- **docs/24 §5.4**: procedimiento del exit criterion (decisión 12).
- **docs/28**: pantalla Deudas → Préstamo (lista, alta nueva/en curso, cronograma con estado, pagar, comparar con la tabla del banco).
- **docs/03 §7**: orden Phase 4: `add-loans` antes de `add-loan-amortization-advanced`; en paralelo con `add-credit-cards` (contexto compartido).
- **contracts/events/README.md**: catálogo `debt/*`.
- **ARCHITECTURE.md §14**: capabilities `debt/loans` y `debt/amortization` ya están en la taxonomía (sin cambios).

## Preguntas abiertas

1. **[B] Cuota con ACT/360, ACT/365 o primer periodo irregular.** Con la fórmula estándar la última cuota absorbe residuos grandes (50000.00 BOB, 11.50 %, 24 cuotas: ACT/360 ⇒ última 2447.38 frente a 2342.02; primer periodo de 44 días ⇒ última 2620.36). Opciones: (a) fórmula estándar siempre, la última absorbe; (b) **cuota nivelada solo para ACT/* y primer periodo irregular: la menor cuota en centavos que minimiza |última − cuota| (ACT/360 ⇒ 2345.94, última 2345.90); 30/360 regular sin cambios**; (c) en este change solo 30/360 y ACT/* en el change avanzado. **Recomendación: (b)**, validándolo con la tabla del banco (pregunta 2). Bloquea el calculador para ACT/*; 30/360 puede empezar.
2. **[B] Tabla real del banco del owner para el exit criterion.** ¿Qué préstamo(s) y banco? ¿Convención (30/360 o días reales), seguro de desgravamen (fijo o % del saldo, sobre qué saldo), comisiones e impuestos por cuota, día de vencimiento y ajuste por feriados? **Recomendación:** que el owner comparta (fuera del repositorio) la tabla y el contrato de un préstamo antes de cerrar el calculador; el procedimiento de comparación queda como está. No bloquea empezar 30/360; bloquea cerrar la fase.
3. **Orden de imputación por defecto** (docs/04 pregunta 6): impuestos → seguro → comisiones → interés → principal. Opciones: (a) **fijo con ese orden en Phase 4**; (b) configurable por préstamo. **Recomendación: (a)**, con el desglose explícito para los casos raros.
4. **Cuenta del préstamo**: (a) **elegir una existente o crearla en el mismo acto (puerto `AccountProvisioningPort`)**; (b) solo existente (dos pasos). **Recomendación: (a).**
5. **Préstamo en USD pagado desde una cuenta en BOB** (habitual en Bolivia). Opciones: (a) **rechazar con `CURRENCY_MISMATCH`; registrar antes la conversión a una cuenta USD**; (b) pago con conversión implícita (transacción compuesta pago + conversión). **Recomendación: (a)** en Phase 4.
6. **Movimientos manuales en la cuenta del préstamo** (transferencia o ajuste fuera del préstamo). Opciones: (a) **permitidos y mostrados como diferencia no registrada en el detalle**; (b) bloqueados para cuentas con préstamo; (c) convertirlos en pago. **Recomendación: (a).**
7. **Morosidad** (`delinquent`, `LoanInstallmentOverdue.v1`, aviso de cuota vencida). **Recomendación:** fuera de Phase 4; la cuota atrasada se ve en el detalle y en próximos pagos (estado atrasada del motor).
8. **Ajuste de vencimientos por fin de semana o feriado.** **Recomendación:** fuera de este change; la comparación lo detecta como diferencia de fechas; si la tabla del owner lo requiere, se agrega `businessDayAdjustment: NONE|NEXT` reutilizando la regla del motor (D130: feriados fuera).
9. **Cargos `RATE_ON_BALANCE`**: base = saldo al inicio del periodo, tasa mensual prorrateada por meses del periodo. ¿Coincide con el seguro de desgravamen del owner? **Recomendación:** aceptar y validar con la pregunta 2.
10. **Pagar una cuota desde la pantalla de recurrentes.** (a) **`RECURRING_MANAGED_EXTERNALLY` y la UI ofrece "Registrar pago" que abre el formulario del préstamo prellenado**; (b) aprobar la ocurrencia llama a Debt por un puerto inverso. **Recomendación: (a)** (sin dependencia de COMMITMENTS hacia DEBT).
11. **Recorrido (D37) del préstamo como Should en este change.** **Recomendación:** sí.
12. **Comisión de originación no retenida** (pagada aparte). **Recomendación:** se registra como gasto normal en "Comisiones de préstamo"; solo la retenida va en el desembolso.
