# Tareas

> Requiere aplicados: `add-event-outbox`, `add-audit-trail`, `add-ledger-core`, `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`. Coordina con `add-market-rate-providers` y `add-demo-data`. Decisión del owner docs/31 D37.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `audit/lifecycle-timeline`, el requirement añadido a `transactions/transfers` y las preguntas abiertas de design.md (comisión en otra moneda —propuesta: no en Phase 1—, `ConversionRevised`); verificar con `openspec validate add-lifecycle-timeline --strict`
- [ ] 1.2 Revisar TC-AUDIT-LIFECYCLE-001..013 y TC-TRANSACTIONS-TRANSFER-009 contra los scenarios (cifras a mano, fechas fijas, `FixedClock`); actualizar la nota de TC-TRANSACTIONS-TRANSFER-006; verificar con `pnpm traceability:check` que todo Must tiene ≥ 1 TC

## 2. DOMAIN (TDD)

- [ ] 2.1 `LifecycleMachine` (tipo de datos puro en el shared-kernel o `@pf/audit/contracts`) y declaraciones `TransactionLifecycle`, `AccountLifecycle`, `ExchangeRateLifecycle`; tests primero: transiciones permitidas/prohibidas (TC-AUDIT-LIFECYCLE-001), terminales, guardas existentes sin cambio de comportamiento
- [ ] 2.2 Agregados `Transaction`, `Account` y `ExchangeRate` validan cada cambio de estado contra su máquina y devuelven el `TransitionRecord` (origen, destino, revisión, asientos); TDD de la revisión de transacciones y transferencias (TC-AUDIT-LIFECYCLE-003, TC-TRANSACTIONS-TRANSFER-009: `TransferCompleted` una sola vez, `TransferRevised` en `REVISE`)

## 3. APPLICATION

- [ ] 3.1 `AuditPort.recordTransition` y `recordAnnotation` en la UoW de todos los comandos que cambian estado (Transactions, Accounts, FX manual); test de atomicidad (TC-AUDIT-LIFECYCLE-002) y de anotaciones (TC-AUDIT-LIFECYCLE-004)
- [ ] 3.2 Query `GetLifecycle` en AUDIT con composición de la máquina del contexto dueño y de las queries públicas de revisión/detalle; tests con TC-AUDIT-LIFECYCLE-005, -007, -008, -009, -010
- [ ] 3.3 Job `audit.lifecycle-backfill` (idempotente, reanudable, `derived = true`, `historyComplete`); tests con TC-AUDIT-LIFECYCLE-011
- [ ] 3.4 Chequeo de consistencia estado ↔ última transición en el invariant checker (FR-LEDGER-015)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand `audit.lifecycle_transition` (RLS forzada, grants SELECT/INSERT, `platform.forbid_mutation()`); tests de integración: inmutabilidad (TC-AUDIT-LIFECYCLE-012) y aislamiento entre workspaces (TC-AUDIT-LIFECYCLE-006); registrar la tabla en `platform.workspace_scoped_table` si `add-demo-data` ya existe
- [ ] 4.2 Consumidor `reporting.data-version` suscrito a `transactions.TransferRevised.v1`; test de idempotencia (reentrega, TC-TRANSACTIONS-TRANSFER-009)

## 5. API

- [ ] 5.1 Endpoints de lifecycle y de máquinas según design.md § Contratos; tests de API y de contrato (TC-AUDIT-LIFECYCLE-005, -006); schemas de eventos `TransferRevised.v1` y campo `transition` validados con Ajv strict (productor)

## 6. UI

- [ ] 6.1 Componente `LifecycleReport` (diagrama SVG desde la máquina con camino recorrido numerado, estado actual destacado, no recorridos atenuados; línea de tiempo accesible con enlaces a revisión y asientos; TZ del workspace; i18n es/en/pt preparado) en el detalle de transacción y de cuenta; tests de componentes con TC-AUDIT-LIFECYCLE-013
- [ ] 6.2 Responsive (vertical bajo 768 px) y estado "historia previa incompleta" para recorridos derivados

## 7. TESTS automatizados y E2E

- [ ] 7.1 E2E Playwright: registrar un gasto pendiente, postearlo, corregirlo y anularlo; abrir "Recorrido" y verificar diagrama y línea de tiempo (TC-AUDIT-LIFECYCLE-013); VIEWER ve el recorrido (TC-AUDIT-LIFECYCLE-006)
- [ ] 7.2 Agregar TC-TRANSACTIONS-TRANSFER-009 y TC-AUDIT-LIFECYCLE-003 a la Financial Regression Suite

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/04 (máquinas de estado como lenguaje ubicuo), docs/08 (`audit.lifecycle_transition`), docs/10 (endpoints de lifecycle), docs/11 (`TransferRevised.v1`, semántica de `TransferCompleted`, campo `transition`) y docs/28 (patrón visual "Recorrido")
- [ ] 8.2 Actualizar estados de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check`
