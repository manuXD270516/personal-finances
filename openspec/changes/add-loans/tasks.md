# Tareas

> Requiere aplicados `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-ledger-core`, `add-classification`, `add-recurrence-engine`, `add-subscriptions`, `add-commitment-matching`, `add-upcoming-payments`, `add-financial-periods`, `add-lifecycle-timeline` y `add-workspace-export`. Coordina con `add-credit-cards` (contexto `@pf/debt` compartido). No cerrar el calculador para ACT/360, ACT/365 ni primer periodo irregular con la pregunta 1 de design.md sin resolver; 30/360 regular puede empezar. El exit criterion requiere la pregunta 2 (tabla real del banco, fuera del repositorio).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner las specs `debt/loans`, `debt/amortization`, los deltas de `commitments/recurrence-engine` y `transactions/transaction-recording` y las preguntas abiertas 1–12 de design.md; `openspec validate add-loans --strict` — _2026-10-10: revisado con las decisiones del owner D153–D164 (docs/37, PR #100); `openspec validate` en verde._
- [x] 1.2 Acordar las necesidades N1–N9 del motor de recurrencia (design.md § Dependencias con el motor) y el reparto del contexto `@pf/debt` con `add-credit-cards` — _2026-10-10: N1–N9 implementadas en COMMITMENTS con el puerto público `RecurringDefinitionPort`; el contexto `@pf/debt` lo crea este change (L1)._
- [x] 1.3 Revisar TC-DEBT-LOAN-001..045 y TC-DEBT-AMORT-001..020 contra los scenarios (recalcular a mano: 1000.00/3/1 % ⇒ 340.02, 340.02, 340.03; 50000.00/11.50 %/24 ⇒ 2342.02, última 2341.90, interés total 6208.36; 30000.00/18 ⇒ 1822.50, última 1822.53; 12000.00 trimestral ⇒ 3228.32, última 3228.34; ACT/365 ⇒ 488.36; ACT/360 ⇒ 495.14; 44 días 30/360 ⇒ 702.78), `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed`; `pnpm traceability:check` sin errores — _2026-10-10: cifras recalculadas por los tests dorados (TC-DEBT-AMORT-001..011); TC pasados a `ready`/`confirmed`/`automated`. Desvío: con hoy = 2026-10-15 y horizonte de 90 días la cuota del 2027-01-15 aún no se genera (límite 2027-01-13); el scenario de TC-DEBT-LOAN-035 pasó a hoy = 2026-10-17._

## 2. DOMAIN (TDD, lógica financiera crítica)

- [x] 2.1 `AmortizationCalculator` francés test-first con la tabla dorada de docs/09 §12: TC-DEBT-AMORT-001, -002, -003; PBT de INV-017 e INV-016 (Σ principal = P, componentes ≥ 0, total = Σ componentes, saldo final 0, determinismo; BOB y USDT; ≥ 1 000 casos en CI): TC-DEBT-AMORT-004, -005 — _2026-10-10: `amortization-calculator.test.ts` (PBT de 1 000 casos en CI, 100 000 con `NIGHTLY`)._
- [x] 2.2 Convenciones de días (30/360 europeo, ACT/360, ACT/365), periodicidades y fechas (día 29–31 ⇒ fin de mes, primer periodo irregular): TC-DEBT-AMORT-006..010; cuota nivelada (`levelInstallment`) solo si se aprueba la pregunta 1 — _2026-10-10: cuota nivelada (D153) en ACT/360, ACT/365 y primer periodo irregular._
- [x] 2.3 Cargos `FIXED` y `RATE_ON_BALANCE`: TC-DEBT-AMORT-011
- [x] 2.4 `PaymentAllocator` test-first (orden impuestos → seguro → comisiones → interés → principal, varias cuotas, parcial, desglose explícito, sobrepago): TC-DEBT-LOAN-012..018; PBT: Σ imputado = monto y ninguna cuota supera lo esperado salvo desglose explícito — _2026-10-10: `payment-allocator.test.ts` (PBT incluido)._
- [x] 2.5 AR `Loan` y `LoanStateMachine` (validaciones de alta, `LOAN_METHOD_NOT_AVAILABLE`, `LOAN_TERMS_LOCKED`, transiciones y guardas, saldado y reactivación): TC-DEBT-LOAN-001..003, -027, -028, -044, -045, TC-DEBT-AMORT-013, -014 — _2026-10-10: `loan.test.ts`._
- [x] 2.6 `ScheduleComparator` (emparejado por número, diferencias por componente, resumen, sugerencias por convención y heurísticas): TC-DEBT-AMORT-017..019
- [x] 2.7 `ReferenceScheduleParser` (CSV/pegado, mapeo, fecha y decimal explícitos, límites, error por fila); extraer a `@pf/shared-kernel` los helpers de lectura delimitada de `imports` si no son compartibles: TC-DEBT-AMORT-015, -016 — _2026-10-10: el lector delimitado se copió y adaptó a `debt/src/domain/delimited-text.ts` (no se extrajo a shared-kernel para no tocar `imports`)._

## 3. APPLICATION

- [x] 3.1 `RegisterLoan` (borrador con vista previa; cuenta existente o `AccountProvisioningPort`; validaciones de cuentas) y `PreviewSchedule`: TC-DEBT-LOAN-001..006, -043, TC-DEBT-AMORT-012
- [x] 3.2 `DisburseLoan` (UoW: `LoanTransactionsPort.recordDisbursement`, versión 1, `createManaged`, transición, auditoría, `LoanDisbursed.v1` + `LoanScheduleGenerated.v1`): TC-DEBT-LOAN-007..009
- [x] 3.3 `RegisterExistingLoan` (saldo inicial vía puerto o verificación con `AccountBalancesQuery`): TC-DEBT-LOAN-010, -011
- [x] 3.4 `RecordLoanPayment` (`FOR UPDATE`, asignación, `LoanTransactionsPort.recordPayment`, `settle`/`setExpected`, `PAY_OFF`, `LoanPaymentRecorded.v1`/`LoanPaidOff.v1`, idempotencia): TC-DEBT-LOAN-012..018, -024, -025, -027, -032, -033
- [x] 3.5 `VoidLoanPayment` (solo el último, `voidManaged`, `unsettle`, `REACTIVATE`, `LoanPaymentVoided.v1`) y `CancelLoan`: TC-DEBT-LOAN-020, -021, -026, -028, -045
- [x] 3.6 Queries `GetLoan` (pendiente por cronograma vs cuenta, atrasadas con hoy en la TZ, acumulados), `ListLoans`, `GetAmortizationSchedule` (estado derivado y diferencias por componente), `ListLoanPayments`; `LoanPortfolioQuery` público: TC-DEBT-LOAN-029, -030 — _2026-10-10: `unreconciledDifference` = principal pendiente − saldo de la cuenta._
- [x] 3.7 `UploadReferenceSchedule`, `CompareSchedule`, `ExplainComparison`, export CSV: TC-DEBT-AMORT-015..020
- [x] 3.8 Recorrido: máquina `Loan` en `audit/lifecycle-timeline` (Should): TC-DEBT-LOAN-034
- [x] 3.9 TRANSACTIONS: kinds `LOAN_DISBURSEMENT`/`LOAN_PAYMENT`, `LoanPaymentBreakdown`, `LoanTransactionsPort` (desembolso, pago, anulación administrada), guarda `TRANSACTION_MANAGED_EXTERNALLY`, flujos nominales con `LOAN_*`: TC-DEBT-LOAN-019, -040..042
- [x] 3.10 COMMITMENTS: `RecurringDefinitionPort` para `DEBT` (N1–N9: calendario explícito, `NOTIFY_ONLY`, guarda de acciones, resolución 1:N, `setExpected`/`unsettle`/`end`, filtros de liberación y matcher, comprometido y próximos pagos con `LOAN_PAYMENT`): TC-DEBT-LOAN-022, -023, -035..039 — _2026-10-10: ver `packages/contexts/commitments` (`recurring-definition-port.ts`, `managed-guard.ts`); se agregó `revise` al puerto; `replaceSchedule` queda para `add-loan-amortization-advanced`._
- [x] 3.11 ACCOUNTS: `AccountProvisioningPort.openAccount` en la UoW del llamador (validaciones y auditoría de `OpenAccount`): TC-DEBT-LOAN-004, -010

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand del schema `debt` (8 tablas, RLS forzada, grants, `forbid_mutation` en las append-only, `platform.workspace_scoped_table`); tests de integración Testcontainers: aislamiento entre workspaces, append-only de versiones y referencias, `UNIQUE (transaction_id)` de pagos, pagos concurrentes serializados
- [x] 4.2 Migraciones expand en `txn` (CHECK `kind`, `loan_payment_breakdown`, `assert_splits_sum()` con `LOAN_*`) y `commitments` (`LOAN_PAYMENT` con `DEBT`, `explicit_schedule`, índice de vinculación parcial); tests de integración de cuadre y splits
- [x] 4.3 Repositorios Kysely y adapters (`LoanTransactionsPort`, `AccountProvisioningPort`, `RecurringDefinitionPort`, `AccountsQueryPort`, `AccountBalancesQuery`, `ClassificationValidator` para el prestamista, `WorkspaceCalendarQuery`, `Clock`)
- [x] 4.4 Esquemas `contracts/events/debt/LoanDisbursed.v1`, `LoanScheduleGenerated.v1`, `LoanPaymentRecorded.v1`, `LoanPaymentVoided.v1`, `LoanPaidOff.v1` con `examples` + test de contrato (payload validado al escribir en el outbox)
- [x] 4.5 Portabilidad: secciones de las tablas en `@pf/debt/contracts/portability.ts` (remapeo de cuentas, transacciones, definición y referencias); test de cobertura de tablas y round-trip con un préstamo con pagos — _2026-10-10: órdenes 780–787; round-trip con préstamo y pago en `workspace-import.api.test.ts`._

## 5. API

- [x] 5.1 OpenAPI aditivo (operaciones de design.md § Contratos, `Transaction.loanPaymentBreakdown`/`loanId`, `RecurringKind` legible, códigos nuevos en `ErrorCode`); `oasdiff` sin rupturas — _2026-10-10: `oasdiff` sin rupturas, Redocly y Spectral limpios. Desvíos: export CSV en `…/comparison/export` (Spectral exige kebab-case sin extensión); `RecurringCadence` pasó a `x-extensible-enum` (con `EXPLICIT`) y las peticiones usan `RecurringCadenceInput`._
- [x] 5.2 Controller `loans` (roles, `Idempotency-Key`, `If-Match`/`ETag`, RFC 9457, multipart de la referencia con límite de 256 KiB); tests de API: TC-DEBT-LOAN-001..034, -043..045, TC-DEBT-AMORT-012..020 — _2026-10-10: la tabla del banco viaja como JSON (`text`, `mapping`, `rows`); el cliente lee el CSV como texto UTF-8 (sin multipart)._
- [x] 5.3 Tests de API de transacciones y recurrentes con préstamos: TC-DEBT-LOAN-035..042

## 6. UI

- [x] 6.1 Deudas → lista de préstamos (pendiente, próxima cuota, estado) y alta en dos modos (nuevo / en curso) con vista previa del cronograma y creación de la cuenta (docs/28; saldos de pasivo como "Deuda Bs …")
- [x] 6.2 Detalle del préstamo: cronograma con estado y esperado/pagado/diferencia por componente, registrar pago (imputación automática o desglose del recibo), anular el último pago, cancelar, diferencia con la cuenta, recorrido
- [x] 6.3 Comparar con la tabla del banco: pegar o subir, mapeo de columnas, reporte por cuota, sugerencias, explicación y export CSV
- [x] 6.4 Recurrentes: ocurrencias de cuotas con el préstamo de origen y acción "Registrar pago" que abre el formulario del préstamo (pregunta 10); transacciones: badge del préstamo y acciones financieras deshabilitadas — _2026-10-10: pendiente menor: notas/etiquetas de transacciones `LOAN_*` no se editan desde la UI (la API lo permite)._
- [x] 6.5 i18n es/en/pt de textos nuevos; accesibilidad (tablas con encabezados, foco en errores de fila)

## 7. TESTS / E2E

- [x] 7.1 E2E (Playwright, stack con `PF_E2E_PROJECT` explícito): registrar el préstamo vehicular, desembolsar, ver la cuota en Q8, pagar la cuota 1, ver el interés en el gasto del mes y la deuda en 48137.15 BOB
- [x] 7.2 E2E de comparación: cargar una tabla sintética con un centavo de diferencia en la cuota 24, ver el reporte y explicar la diferencia
- [x] 7.3 Regresión: TC-COMMITMENTS-*, TC-REPORTING-UPCOMING-*, TC-REPORTING-KPI-*, TC-PLANNING-ACTUAL-*, TC-IDENTITY-PORTABILITY-* en verde

## 8. DOCS

- [x] 8.1 Aplicar los cambios de design.md § Cambios a docs compartidos (docs/01, 03, 04, 05, 06, 08, 09, 10, 11, 14, 24, 28; `contracts/events/README.md`)
- [x] 8.2 Actualizar la matriz de trazabilidad (INV-016 e INV-017 con TC activos desde Phase 4, regla R7 de docs/17) y los estados de los TC; `openspec validate add-loans --strict`, `pnpm traceability:check`, `pnpm format:check`
- [ ] 8.3 (Could) Datos demo: un préstamo vehicular con 3 cuotas pagadas en el generador de docs/29 — _2026-10-10: no implementado (Could); queda para un seguimiento._
- [ ] 8.4 Exit criterion: el owner compara su tabla real (fuera del repositorio) y el resultado `MATCH` o `EXPLAINED` se registra en el informe de cierre de Phase 4 sin cifras personales — _2026-10-10: pendiente del owner (tabla real fuera del repositorio); la comparación completa con CSV, texto pegado y filas está lista._
