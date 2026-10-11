# @pf/debt — bounded context DEBT

Préstamos y tarjetas de crédito. Tarjetas (openspec `add-credit-cards`, `debt/credit-cards`, FR-DEBT-012..017, Phase 4): perfil sobre cuentas `credit_card`
existentes (una por moneda, límite separado o compartido), ciclos con cierre y vencimiento (1–31, fin de mes, zona del workspace), estados de
cuenta emitidos una sola vez por el job `debt.card-daily` (cifras congeladas y recálculo con diferencia), pago mínimo HALF_EVEN, pago como
transferencia que no es gasto, plan de pago administrado (`CARD_PAYMENT`, `managedBy = DEBT`), recordatorio, utilización con alertas (consumidor
`debt.card-activity`) y cuotas. Debt no escribe en el ledger. Detalle en `src/domain/card-*.ts`, `src/application/card*.ts` y la migración
`apps/api/db/migrations/20261012110000_debt_credit_cards.sql`.

Préstamos (openspec `add-loans`; capabilities `debt/loans` y `debt/amortization`, FR-DEBT-001..003, 006, 007 y 011, Must, Phase 4):
registro de préstamos nuevos y en curso, desembolso y pago como **transacciones administradas** (`LOAN_DISBURSEMENT` / `LOAN_PAYMENT`,
`source = DEBT`), cronograma francés versionado al centavo, imputación de pagos por componente, cuotas como compromisos
recurrentes `LOAN_PAYMENT` y **comparación con la tabla del banco** (exit criterion de Phase 4). Las tarjetas (`add-credit-cards`) y la
amortización avanzada (`add-loan-amortization-advanced`: alemán, capital fijo, custom, prepagos, tasa variable, `replaceSchedule`) se
suman después sobre este mismo contexto, sin migraciones destructivas.

Flujo: **registrar** (`NEW`, borrador con vista previa del cronograma sin persistir, o `EXISTING` con saldo pendiente a una fecha) →
**desembolsar** (transacción + versión 1 del cronograma + definición de cuotas en COMMITMENTS, en una sola UoW) → **pagar** (monto con
imputación automática en el orden fijo impuestos → seguro → comisiones → interés → principal, o con desglose explícito de una cuota;
solo se anula el último pago) → **saldar** (`PAID_OFF`, reactivable al anular el último pago). La cuenta del préstamo se elige o se crea
en el acto (`AccountProvisioningPort`, D156).

| Capa | Contenido |
|---|---|
| `domain` | AR `Loan` (cabecera, cronograma de la versión vigente, imputaciones y pagos; estado de cuota derivado `UNPAID`/`PARTIALLY_PAID`/`PAID`) con la máquina `LOAN_LIFECYCLE` (`REGISTER`, `DISBURSE`, `REGISTER_EXISTING`, `PAY_OFF`, `REACTIVATE`, `CANCEL`; estados `DRAFT`, `ACTIVE`, `PAID_OFF`, `CANCELLED`, y `PAID_OFF` no es terminal); servicios puros `AmortizationCalculator` (método francés con HALF_EVEN, residuo en la última cuota, cuota nivelada solo con ACT/360, ACT/365 o primer periodo irregular, D153), `PaymentAllocator` (orden fijo, D155), `ScheduleComparator` (por cuota y componente, `MATCH`/diferencias/huérfanas), `ReferenceScheduleParser` (CSV, texto pegado o filas; ≤ 256 KiB y ≤ 600 filas; helpers de lectura delimitada). Sin Nest, Kysely ni módulos de Node. |
| `application` | `LoansService` (registrar, editar, desembolsar, cancelar), `PaymentsService` (pagar, anular el último), `ReferencesService` (cargar la tabla del banco, comparar, exportar CSV, explicar), `LoansQueries` (lista, detalle, cronograma, pagos; implementa `LoanPortfolioQuery`) y el grabador de eventos y auditoría. Dobles en `application/testing`. |
| `infrastructure` | Repositorios Kysely/SQL (`debt.*`) y `PgDebtUnitOfWork`; bloqueo `FOR UPDATE` del préstamo en cada comando (dos pagos concurrentes se serializan). |
| `interface` | `DebtModule` + `LoansController` (`/loans*`, tag Debt de la API), con `Idempotency-Key` en creación, desembolso y pago y `If-Match` en edición, anulación y cancelación. |
| `contracts` | Eventos `debt.LoanDisbursed.v1`, `LoanScheduleGenerated.v1`, `LoanPaymentRecorded.v1`, `LoanPaymentVoided.v1` y `LoanPaidOff.v1`, `LoanPortfolioQuery` (`listLoans`, `interestPaid`; contrato público para `add-debt-summary`), `DEBT_AUDIT_POLICY` y las secciones de portabilidad (órdenes 780–787: `loans`, `loan-schedule-versions`, `loan-installments`, `loan-payments`, `loan-payment-allocations`, `loan-reference-schedules`, `loan-reference-rows`, `loan-schedule-comparisons`). |

Dependencias: solo `contracts` de Transactions (`LoanTransactionsPort`: `recordDisbursement`, `recordPayment`, `voidManaged`), Accounts
(`AccountProvisioningPort.openAccount`, `AccountBalancesQuery`), Commitments (`RecurringDefinitionPort`: `createManaged`, `settle`,
`unsettle`, `setExpected`, `end`, `revise`), Ledger, Planning, Classification, Identity y Audit, y `@pf/shared-kernel`/`@pf/platform`.
Transactions y Commitments **no** importan a Debt: las guardas `TRANSACTION_MANAGED_EXTERNALLY` y `RECURRING_MANAGED_EXTERNALLY`
protegen lo que Debt administra y la imputación nunca diverge de la transacción (INV-016).

Datos: la tabla del banco del owner son datos personales y el repositorio es público; solo se guardan las filas parseadas (nunca el
archivo) y las fixtures usan cifras inventadas. La tasa viaja como fracción decimal en texto (`"0.115"`) y los montos como `Money`.

Esquema de BD: `apps/api/db/migrations/20261011100000_debt_schema.sql` (schema `debt`, 8 tablas con RLS forzada: `loan`,
`loan_schedule_version`, `loan_installment`, `loan_payment`, `loan_payment_allocation`, `loan_reference_schedule`, `loan_reference_row`,
`loan_schedule_comparison`; append-only con `forbid_mutation` en versión, cuotas, imputaciones, referencias y filas),
`20261011100100_txn_loan_kinds.sql` y `20261011100110_txn_loan_ref_uk.sql` (kinds, `loan_payment_breakdown` e índice único por
`externalRef` en Transactions) y `20261011100200_commitments_loan_payment.sql` (`LOAN_PAYMENT`, cadencia `EXPLICIT` y vínculo por
`schedule_key` en Commitments). Decisiones en `openspec/changes/add-loans/design.md` y en docs/37 (D153–D164).

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios, propiedades y aplicación con dobles en memoria (`src/**/*.test.ts`) |
| `pnpm test:integration` | Repositorios, RLS, permisos y restricciones contra PostgreSQL 18 (Testcontainers; requiere Docker). Las pruebas de API viven en `apps/api/test/api/loans.api.test.ts` |
