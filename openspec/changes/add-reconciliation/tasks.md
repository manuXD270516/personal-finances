# Tareas

> Requiere aplicados: `add-transaction-recording`, `add-ledger-core`, `add-accounts-management`, `add-audit-trail`, `add-lifecycle-timeline`, `add-event-outbox`. Coordina con `planning/financial-periods` y `planning/month-closing` (pf-p2a: `PERIOD_CLOSED` y checklist de cierre). Decisiones del owner docs/31 D16, D37, D47, D49. Preguntas abiertas 1–5 resueltas por el owner el 2026-10-08 (docs/33 D65, D74–D77, D111).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner los requirements ADDED/MODIFIED de `transactions/reconciliation` y `audit/lifecycle-timeline` y las preguntas abiertas 1–5 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-reconciliation --strict`
  - 2026-10-08: revisado con el owner; requirements y preguntas abiertas 1–5 resueltos en docs/33 (D65 periodos cerrados, D74 marcado directo como modo explícito, D75 ajuste sin categorizar, D76 sin cuentas CLOSED, D77 migración de las RECONCILED de Phase 1, D111 marca de seguimiento y `getCoverage`); `openspec validate add-reconciliation --strict` verde (`pnpm spec:validate`).
- [x] 1.2 Revisar TC-TRANSACTIONS-RECONCILIATION-001..023 y TC-AUDIT-LIFECYCLE-025..027 contra los scenarios (cifras a mano: 1000.00 − 150.00 + 2500.00 = 3350.00; 3350.00 − 45.90 − 200.00 = 3104.10; ajuste 5.00 ⇒ 3345.00 / 3099.10); pasar a `ready` y `requirement_status: confirmed` al aprobar las specs
  - 2026-10-08: TC-TRANSACTIONS-RECONCILIATION-001..023 y TC-AUDIT-LIFECYCLE-025..027 revisados contra los scenarios; las cifras a mano (3350.00, 3104.10, 3345.00 / 3099.10) están en los tests; pasan a `automated` con sus tests.
- [x] 1.3 Actualizar (en el PR de implementación) TC-TRANSACTIONS-RECONCILED-001, TC-TRANSACTIONS-RECONCILED-003 y TC-TRANSACTIONS-CLEARED-001 a la semántica MODIFIED (modo explícito sin extracto en el marcado directo, `PERIOD_CLOSED`, evento dedicado), registrando el motivo
  - 2026-10-08: TC-TRANSACTIONS-RECONCILED-001, -003 y TC-TRANSACTIONS-CLEARED-001 actualizados a la semántica MODIFIED (modo explícito sin extracto, PERIOD_CLOSED, evento `TransactionCleared`) con la nota de cambio en cada TC.

## 2. DOMAIN (TDD)

- [x] 2.1 `ReconciliationCalculator` puro, test-first: saldo confirmado y diferencia por naturaleza de cuenta (activo y pasivo como deuda), exclusión de `pending`/`posted`/`void` y de fechas posteriores al extracto, saldo inicial incluido una sola vez (TC-TRANSACTIONS-RECONCILIATION-003, -004); PBT: diferencia = extracto − Σ incluidas para conjuntos aleatorios
  - 2026-10-08: `ReconciliationCalculator` (domain/reconciliation-calculator.ts) con tests de las cifras del change y PBT (fast-check) de diferencia = extracto − (saldo inicial + Σ incluidas), activo y pasivo.
- [x] 2.2 AR `Reconciliation` con `RECONCILIATION_LIFECYCLE` (START/COMPLETE/CANCEL, terminales) y guardas: una en curso por cuenta, fecha del extracto, escala de la moneda (TC-TRANSACTIONS-RECONCILIATION-001, -002, -009; TC-AUDIT-LIFECYCLE-025)
  - 2026-10-08: AR `Reconciliation` y máquina `RECONCILIATION_LIFECYCLE` (domain/reconciliation*.ts).
- [x] 2.3 Dirección y monto del ajuste a partir de la diferencia (activo/pasivo), test-first con el traductor de `ADJUSTMENT` existente: asiento balanceado (INV-004/INV-005) (TC-TRANSACTIONS-RECONCILIATION-008)
  - 2026-10-08: `ReconciliationCalculator.adjustmentFor` (INCREASE/DECREASE por signo, activo y pasivo) + asiento balanceado contra `EQUITY:ADJUSTMENTS` en el servicio (tests con el ledger en memoria y con PG real).
- [x] 2.4 `Transaction`: `ReconciliationMode`; `RECONCILE` exige `reconciliationId` y fija `STATEMENT`; `RECONCILE_WITHOUT_STATEMENT` exige el modo explícito (sin él `VALIDATION_FAILED`) y fija `WITHOUT_STATEMENT`; `verifyAgainstStatement`; `systemFlags` derivado; `UNRECONCILE` limpia el modo (TC-TRANSACTIONS-RECONCILIATION-014, -016, -017, -018); guardas de periodo cerrado en `CLEAR`/`UNCLEAR`/`RECONCILE`/`UNRECONCILE` vía `LedgerService.assertPeriodOpen({date})`, según el alcance único de `planning/month-closing` (TC-TRANSACTIONS-RECONCILIATION-012)
  - 2026-10-08: `Transaction`: `reconcile`, `reconcileWithoutStatement` (modo explícito), `verifyAgainstStatement`, `unreconcile` limpia el modo, `systemFlagsOf`; `assertPeriodOpen` en CLEAR/UNCLEAR/RECONCILE/UNRECONCILE desde los servicios (el ledger resuelve el alcance, hoy mensual). Máquina `Transaction` v2 con `RECONCILE_WITHOUT_STATEMENT`.

## 3. APPLICATION

- [x] 3.1 `StartReconciliation` y `CancelReconciliation` con auditoría, transición y roles (TC-TRANSACTIONS-RECONCILIATION-001, -002, -009)
  - 2026-10-08: `ReconciliationsService.start/cancel` con auditoría, transición y roles (API: VIEWER ⇒ INSUFFICIENT_ROLE).
- [x] 3.2 `ToggleClearedInSession` reutilizando `SetClearedStatus` (todo o nada, versiones por ítem) y anotación de la sesión (TC-TRANSACTIONS-RECONCILIATION-005)
  - 2026-10-08: `toggleCleared` reutiliza `TransactionsService.markCleared` con contexto de sesión (todo o nada, versión por ítem, cuenta y fecha del extracto) y sube la versión de la sesión.
- [x] 3.3 `CompleteReconciliation` en `SERIALIZABLE` con reintento: diferencia, `PERIOD_CLOSED`, ajuste opcional, `RECONCILE` por transacción, ítems, auditoría, transiciones y outbox en una UoW; test de atomicidad con fallo inyectado (TC-TRANSACTIONS-RECONCILIATION-006, -007, -008, -012, -013)
  - 2026-10-08: `complete` en una sola unidad de trabajo: SERIALIZABLE con reintento (`x-isolation` del contrato + `PgCommandTransaction`/`PgUnitOfWork` con 3 intentos ante 40001/40P01) y `FOR UPDATE` de la sesión y de las incluidas; test de atomicidad con fallo inyectado de auditoría y test de dos finalizaciones simultáneas.
- [x] 3.4 `TransactionCleared.v1` en todo `CLEAR`/`UNCLEAR` (individual, lote, sesión) además de `TransactionUpdated.v1`; `ReconciliationCompleted.v1` (TC-TRANSACTIONS-RECONCILIATION-011)
  - 2026-10-08: `TransactionCleared.v1` en todo CLEAR/UNCLEAR (individual, lote y sesión; bulk edit lo hereda de `markCleared`) además de `TransactionUpdated.v1`; `ReconciliationCompleted.v1`.
- [x] 3.5 `UnreconcileTransaction` anota la sesión (`reconciliation_item.unreconciled_*`) y respeta `PERIOD_CLOSED` (TC-TRANSACTIONS-RECONCILIATION-015)
  - 2026-10-08: `UnreconcileTransaction` anota la sesión (`reconciliation_item.unreconciled_*` y anotación `TRANSACTION_UNRECONCILED` en su recorrido) y respeta PERIOD_CLOSED.
- [x] 3.6 Query pública `ReconciliationStatusQuery.getCoverage({workspaceId, accountIds, through, from?})` en `@pf/transactions/contracts` para PLANNING, con `reconciledThrough`, `reconciliationBasis` y `reconciledWithoutStatementCount` según design.md decisión 9 (D111), y endpoint `getReconciliationStatus` sobre la misma query (TC-TRANSACTIONS-RECONCILIATION-010, -020)
  - 2026-10-08: `ReconciliationStatusQuery.getCoverage` en `@pf/transactions/contracts` (implementada por `ReconciliationsService`, cableada en `createTransactionsRuntime`) y `getReconciliationStatus` sobre la misma regla; ver TC-020.
- [x] 3.8 `ReconcileWithoutStatement` (auditoría, transición `RECONCILE_WITHOUT_STATEMENT`, `TransactionUpdated.v1` con `reconciliationMode`, `PERIOD_CLOSED`) y cotejo posterior dentro de `CompleteReconciliation` (decisión 14, omitiendo periodos cerrados) (TC-TRANSACTIONS-RECONCILIATION-016, -019, -021, -022, -023)
  - 2026-10-08: `updateTransaction` con `status=RECONCILED` ejecuta `RECONCILE_WITHOUT_STATEMENT` (auditoría `reconciled_without_statement`, `TransactionUpdated` con `reconciliationMode`, PERIOD_CLOSED) y el cotejo posterior vive en `complete`, omitiendo periodos cerrados.
- [x] 3.9 Filtro `systemFlag=RECONCILED_WITHOUT_STATEMENT` en `ListTransactions` y rechazo de `systemFlags` en edición individual y masiva (TC-TRANSACTIONS-RECONCILIATION-018)
  - 2026-10-08: Filtro `systemFlag=RECONCILED_WITHOUT_STATEMENT` en `listTransactions` (índice parcial) y `systemFlags` en el request ⇒ 400 VALIDATION_FAILED (el schema del PATCH es cerrado; hallazgo: VALIDATION_FAILED es 400 en el catálogo, no 422).
- [x] 3.7 Composición del recorrido de la sesión y referencia de la sesión en el recorrido de la transacción; transición `RECONCILE_WITHOUT_STATEMENT` y anotación de cotejo (TC-AUDIT-LIFECYCLE-025, -026, -027)
  - 2026-10-08: Recorrido de la sesión (`getReconciliationLifecycle`), `reconciliations[]` en el recorrido de la transacción, transición `RECONCILE_WITHOUT_STATEMENT` y anotación `RECONCILIATION_VERIFIED` (los pasos de anotación ahora admiten `detailRefs`, aditivo en AUDIT).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand `txn_reconciliation` (tablas, columnas `reconciliation_id` y `reconciliation_mode` con relleno `WITHOUT_STATEMENT` de las `RECONCILED` existentes y CHECK de coherencia con el estado (D77), índice parcial de las sin extracto, RLS forzada, grants, índice único parcial, `platform.workspace_scoped_table`); tests de integración: aislamiento entre workspaces y unicidad de la sesión en curso
  - 2026-10-08: Migración `20261008140000_txn_reconciliation.sql` (tablas, columnas, relleno D77 idempotente suspendiendo FORCE RLS solo dentro de la migración, CHECKs, índice parcial único, RLS forzada, grants, registro en `platform.workspace_scoped_table` y `audit.lifecycle_state_divergences`); tests de integración de aislamiento, unicidad y relleno.
- [x] 4.2 `ReconciliationRepository` (Kysely) y consulta agregada del saldo confirmado; benchmark con dataset `large` (p95 ≤ 150 ms)
  - 2026-10-08: `PgReconciliationRepository` (Kysely) y consulta agregada; benchmark `reconciliation-cleared-balance` agregado al nightly (`nightly.perf.ts`, p95 ≤ 150 ms con el Large Seed; pendiente de su corrida nightly).
- [x] 4.3 Schemas `contracts/events/transactions/TransactionCleared.v1.schema.json` y `ReconciliationCompleted.v1.schema.json`; test de contrato de eventos
  - 2026-10-08: Schemas `TransactionCleared.v1` y `ReconciliationCompleted.v1` con `examples`; los productores se validan contra ellos en los tests de API (outbox) y aditivos en `TransactionCreated/Posted/Updated/Voided`.

## 5. API

- [x] 5.1 Operaciones del contrato (design.md § Contratos) con `x-required-role`, `Idempotency-Key`, `If-Match`; códigos nuevos en `ErrorCode`, `ErrorCatalog` y mensajes es/en/pt; `updateTransaction` con `status=RECONCILED` exige `reconciliationMode: WITHOUT_STATEMENT`; `Transaction.reconciliationMode`/`systemFlags`; filtro `systemFlag`
  - 2026-10-08: Operaciones, códigos de error (ErrorCatalog + mensajes es/en/pt), `Transaction.reconciliationMode/systemFlags`, filtro `systemFlag`, `updateTransaction` con modo explícito; Spectral 0 errores y oasdiff sin rupturas (cambios aditivos; `PATCH status=RECONCILED` sin modo es ahora un rechazo de comportamiento, no del esquema).
- [x] 5.2 Tests de API por TC (incluye VIEWER ⇒ `INSUFFICIENT_ROLE` y otro workspace ⇒ 404)
  - 2026-10-08: `apps/api/test/api/reconciliation.api.test.ts` (VIEWER ⇒ INSUFFICIENT_ROLE, otro workspace ⇒ 404, contrato de respuestas y de eventos).

## 6. UI

- [x] 6.1 Pantalla "Reconciliar" por cuenta: extracto, saldo confirmado y diferencia en vivo, lista con casillas hasta la fecha del extracto, Finalizar con diferencia 0, diálogo de ajuste con motivo, cancelar; historial de sesiones y estado por cuenta en el detalle de la cuenta; acción "Marcar como conciliada sin extracto" con confirmación, insignia "conciliada sin extracto — pendiente de revisión", filtro en el listado e indicador por cuenta
  - 2026-10-08: Pantalla `/cuentas/{id}/reconciliar` (inicio, diferencia en vivo, casillas, ajuste con motivo, finalizar/cancelar, historial), indicador y enlace en el detalle de la cuenta, acción "Marcar como conciliada sin extracto" con confirmación, insignia y filtro "sin extracto" en el listado, i18n es/en/pt y axe (E2E).
- [x] 6.2 Recorrido de la sesión con el componente `LifecycleReport` existente; i18n es/en/pt
  - 2026-10-08: Pestaña Recorrido de la sesión con `LifecycleReport` (extra por fila: extracto, saldo confirmado, diferencia y ajuste) y enlace de las transiciones de la transacción a su sesión.

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar los TC del change con el TC-ID en el nombre; actualizar front matter (`automated_tests`, `status: automated`)
  - 2026-10-08: TC con el ID en el nombre del test; front matter `automated` con `automated_tests` (trazabilidad verde).
- [x] 7.2 E2E Playwright: reconciliar "Bank A" de marzo con diferencia 0 y con ajuste de 5.00 BOB (TC-TRANSACTIONS-RECONCILIATION-006, -008)
  - 2026-10-08: E2E `tests/e2e/specs/reconciliation.spec.ts` (diferencia 0, diferencia en vivo, ajuste de 5.00 BOB, conciliada sin extracto) + axe en `a11y.spec.ts`; corrida con `PF_E2E_PROJECT=pfos-e2e-rec`.

## 8. DOCUMENTATION

- [x] 8.1 Actualizar docs/04 §3.4/§4.1 (máquina `RECONCILIATION_LIFECYCLE`), docs/08 §5.4 (as-built de `txn.reconciliation*`), docs/10 §13 (operaciones reales), docs/11 (eventos nuevos), docs/01 FR-TRANSACTIONS-030 (estado) y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
  - 2026-10-08: docs/01 (FR-030), docs/04 (AR y máquinas), docs/08 (as-built de `txn.reconciliation*` y columnas), docs/10 (operaciones y códigos), docs/11 (eventos) y contracts/events/README actualizados; matriz de trazabilidad regenerada.
