# Tareas

> Requiere aplicados: `add-transaction-recording`, `add-ledger-core`, `add-accounts-management`, `add-audit-trail`, `add-lifecycle-timeline`, `add-event-outbox`. Coordina con `planning/financial-periods` y `planning/month-closing` (pf-p2a: `PERIOD_CLOSED` y checklist de cierre). Decisiones del owner docs/31 D16, D37, D47, D49. No iniciar la implementación sin resolver las preguntas abiertas 1 y 2 de design.md.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los requirements ADDED/MODIFIED de `transactions/reconciliation` y `audit/lifecycle-timeline` y las preguntas abiertas 1–5 de design.md; verificar con `openspec validate add-reconciliation --strict`
- [ ] 1.2 Revisar TC-TRANSACTIONS-RECONCILIATION-001..015 y TC-AUDIT-LIFECYCLE-025..026 contra los scenarios (cifras a mano: 1000.00 − 150.00 + 2500.00 = 3350.00; 3350.00 − 45.90 − 200.00 = 3104.10; ajuste 5.00 ⇒ 3345.00 / 3099.10); pasar a `ready` y `requirement_status: confirmed` al aprobar las specs
- [ ] 1.3 Actualizar (en el PR de implementación) TC-TRANSACTIONS-RECONCILED-001, TC-TRANSACTIONS-RECONCILED-003 y TC-TRANSACTIONS-CLEARED-001 a la semántica MODIFIED (sesión obligatoria, `PERIOD_CLOSED`, evento dedicado), registrando el motivo

## 2. DOMAIN (TDD)

- [ ] 2.1 `ReconciliationCalculator` puro, test-first: saldo confirmado y diferencia por naturaleza de cuenta (activo y pasivo como deuda), exclusión de `pending`/`posted`/`void` y de fechas posteriores al extracto, saldo inicial incluido una sola vez (TC-TRANSACTIONS-RECONCILIATION-003, -004); PBT: diferencia = extracto − Σ incluidas para conjuntos aleatorios
- [ ] 2.2 AR `Reconciliation` con `RECONCILIATION_LIFECYCLE` (START/COMPLETE/CANCEL, terminales) y guardas: una en curso por cuenta, fecha del extracto, escala de la moneda (TC-TRANSACTIONS-RECONCILIATION-001, -002, -009; TC-AUDIT-LIFECYCLE-025)
- [ ] 2.3 Dirección y monto del ajuste a partir de la diferencia (activo/pasivo), test-first con el traductor de `ADJUSTMENT` existente: asiento balanceado (INV-004/INV-005) (TC-TRANSACTIONS-RECONCILIATION-008)
- [ ] 2.4 `Transaction`: `RECONCILE` exige `reconciliationId`; el marcado directo se rechaza con `RECONCILIATION_SESSION_REQUIRED` (TC-TRANSACTIONS-RECONCILIATION-014); guardas de periodo cerrado en `CLEAR`/`UNCLEAR`/`RECONCILE`/`UNRECONCILE` vía `LedgerService.assertPeriodOpen({date})`, según el alcance único de `planning/month-closing` (TC-TRANSACTIONS-RECONCILIATION-012)

## 3. APPLICATION

- [ ] 3.1 `StartReconciliation` y `CancelReconciliation` con auditoría, transición y roles (TC-TRANSACTIONS-RECONCILIATION-001, -002, -009)
- [ ] 3.2 `ToggleClearedInSession` reutilizando `SetClearedStatus` (todo o nada, versiones por ítem) y anotación de la sesión (TC-TRANSACTIONS-RECONCILIATION-005)
- [ ] 3.3 `CompleteReconciliation` en `SERIALIZABLE` con reintento: diferencia, `PERIOD_CLOSED`, ajuste opcional, `RECONCILE` por transacción, ítems, auditoría, transiciones y outbox en una UoW; test de atomicidad con fallo inyectado (TC-TRANSACTIONS-RECONCILIATION-006, -007, -008, -012, -013)
- [ ] 3.4 `TransactionCleared.v1` en todo `CLEAR`/`UNCLEAR` (individual, lote, sesión) además de `TransactionUpdated.v1`; `ReconciliationCompleted.v1` (TC-TRANSACTIONS-RECONCILIATION-011)
- [ ] 3.5 `UnreconcileTransaction` anota la sesión (`reconciliation_item.unreconciled_*`) y respeta `PERIOD_CLOSED` (TC-TRANSACTIONS-RECONCILIATION-015)
- [ ] 3.6 Query pública `ReconciliationStatusQuery.getCoverage({workspaceId, accountIds, through})` en `@pf/transactions/contracts` para PLANNING, con `reconciledThrough` según design.md decisión 9, y endpoint `getReconciliationStatus` sobre la misma query (TC-TRANSACTIONS-RECONCILIATION-010)
- [ ] 3.7 Composición del recorrido de la sesión y referencia de la sesión en el recorrido de la transacción (TC-AUDIT-LIFECYCLE-025, -026)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand `txn_reconciliation` (tablas, columna `reconciliation_id`, RLS forzada, grants, índice único parcial, `platform.workspace_scoped_table`); tests de integración: aislamiento entre workspaces y unicidad de la sesión en curso
- [ ] 4.2 `ReconciliationRepository` (Kysely) y consulta agregada del saldo confirmado; benchmark con dataset `large` (p95 ≤ 150 ms)
- [ ] 4.3 Schemas `contracts/events/transactions/TransactionCleared.v1.schema.json` y `ReconciliationCompleted.v1.schema.json`; test de contrato de eventos

## 5. API

- [ ] 5.1 Operaciones del contrato (design.md § Contratos) con `x-required-role`, `Idempotency-Key`, `If-Match`; códigos nuevos en `ErrorCode`, `ErrorCatalog` y mensajes es/en/pt; `updateTransaction` con `status=RECONCILED` ⇒ 409
- [ ] 5.2 Tests de API por TC (incluye VIEWER ⇒ `INSUFFICIENT_ROLE` y otro workspace ⇒ 404)

## 6. UI

- [ ] 6.1 Pantalla "Reconciliar" por cuenta: extracto, saldo confirmado y diferencia en vivo, lista con casillas hasta la fecha del extracto, Finalizar con diferencia 0, diálogo de ajuste con motivo, cancelar; historial de sesiones y estado por cuenta en el detalle de la cuenta
- [ ] 6.2 Recorrido de la sesión con el componente `LifecycleReport` existente; i18n es/en/pt

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar los TC del change con el TC-ID en el nombre; actualizar front matter (`automated_tests`, `status: automated`)
- [ ] 7.2 E2E Playwright: reconciliar "Bank A" de marzo con diferencia 0 y con ajuste de 5.00 BOB (TC-TRANSACTIONS-RECONCILIATION-006, -008)

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar docs/04 §3.4/§4.1 (máquina `RECONCILIATION_LIFECYCLE`), docs/08 §5.4 (as-built de `txn.reconciliation*`), docs/10 §13 (operaciones reales), docs/11 (eventos nuevos), docs/01 FR-TRANSACTIONS-030 (estado) y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
