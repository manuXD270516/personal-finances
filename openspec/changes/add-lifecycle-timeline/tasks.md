# Tareas

> Requiere aplicados: `add-event-outbox`, `add-audit-trail`, `add-ledger-core`, `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`. Coordina con `add-market-rate-providers` y `add-demo-data`. Decisión del owner docs/31 D37.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `audit/lifecycle-timeline`, el requirement añadido a `transactions/transfers` y las preguntas abiertas de design.md (comisión en otra moneda —propuesta: no en Phase 1—, `ConversionRevised`); verificar con `openspec validate add-lifecycle-timeline --strict`
  > Revisado 2026-10-04 (sigue pendiente del owner): la pregunta 1 (comisión en otra moneda) quedó resuelta por docs/31 D40. Siguen abiertas sin decisión: 2 `ConversionRevised.v1` vs re-emisión de `ConversionRecorded`, 3 recorrido de categorías/contrapartes en Phase 1 y 4 exportación del recorrido.
  > Revisado 2026-10-05: la pregunta 2 quedó resuelta por el owner (docs/31 D48: se agrega `transactions.ConversionRevised.v1`). Siguen abiertas 3 (recorrido de categorías/contrapartes en Phase 1) y 4 (exportación del recorrido), por eso 1.1 no se cierra.
- [x] 1.2 Revisar TC-AUDIT-LIFECYCLE-001..013 y TC-TRANSACTIONS-TRANSFER-009 contra los scenarios (cifras a mano, fechas fijas, `FixedClock`); actualizar la nota de TC-TRANSACTIONS-TRANSFER-006; verificar con `pnpm traceability:check` que todo Must tiene ≥ 1 TC
  - 2026-10-04: cifras verificadas a mano (1000.00 − 102.00 = 898.00; 1000.00 − 300.00 + 50.00 = 750.00; 685.00/100 = 6.85, 686.00/100 = 6.86); la nota de TRANSFER-006 ya estaba. Los TC automatizados llevan `automated_tests` y una nota de implementación (códigos de estado del contrato, ruta `fx-rates`, orden por instante). `traceability:check` OK (solo advertencias R3 previas, ajenas a este change).

## 2. DOMAIN (TDD)

- [x] 2.1 `LifecycleMachine` (tipo de datos puro en el shared-kernel o `@pf/audit/contracts`) y declaraciones `TransactionLifecycle`, `AccountLifecycle`, `ExchangeRateLifecycle`; tests primero: transiciones permitidas/prohibidas (TC-AUDIT-LIFECYCLE-001), terminales, guardas existentes sin cambio de comportamiento
  - 2026-10-04: `LifecycleMachine` en `@pf/shared-kernel` (validación de la declaración, `transition`, `replay`, `reachableStates`); máquinas `TRANSACTION_LIFECYCLE`, `ACCOUNT_LIFECYCLE`, `EXCHANGE_RATE_LIFECYCLE` en el dominio de cada contexto; `transaction-status.ts` deriva de la máquina sin cambiar guardas (`TRANSACTION_RECONCILED`, D16). Tests primero con TC-AUDIT-LIFECYCLE-001 (incl. PBT fast-check y enumeración exhaustiva para cuentas). Ver design.md § Decisiones de implementación 1–2.
- [x] 2.2 Agregados `Transaction`, `Account` y `ExchangeRate` validan cada cambio de estado contra su máquina y devuelven el `TransitionRecord` (origen, destino, revisión, asientos); TDD de la revisión de transacciones y transferencias (TC-AUDIT-LIFECYCLE-003, TC-TRANSACTIONS-TRANSFER-009: `TransferCompleted` una sola vez, `TransferRevised` en `REVISE`)
  - 2026-10-04: `Transaction.lastTransition` / `Account.lastTransition` (validados contra la máquina en cada método; `REVISE` solo con `ledgerImpact`); `TransferCompleted` una sola vez y `TransferRevised.v1` en `REVISE` (`publishPosted`); test de arquitectura `lifecycle.architecture.test.ts`. TC-AUDIT-LIFECYCLE-003 y TC-TRANSACTIONS-TRANSFER-009 en dominio y aplicación (el test que esperaba la re-emisión de `TransferCompleted` se reemplazó por TRANSFER-009, como prevé proposal § Impacto de regresión).
  - 2026-10-05 (docs/31 D48): simetría para conversiones — `ConversionRecorded.v1` solo en el primer asiento (`RECORD`/`POST`) y `REVISE` de `kind=CONVERSION` publica `transactions.ConversionRevised.v1` (`publishPosted`/`conversionRevisedPayload`, `AmendConversion` pasa los tres asientos); eventos de `REVISE` en `TRANSACTION_LIFECYCLE` cambian `ConversionRecorded.v1` por `ConversionRevised.v1`. TDD con TC-TRANSACTIONS-CONVERSION-012 (dominio y aplicación; la corrección de una `PENDING` no lo publica).

## 3. APPLICATION

- [x] 3.1 `AuditPort.recordTransition` y `recordAnnotation` en la UoW de todos los comandos que cambian estado (Transactions, Accounts, FX manual); test de atomicidad (TC-AUDIT-LIFECYCLE-002) y de anotaciones (TC-AUDIT-LIFECYCLE-004)
  - 2026-10-04: implementado como `LifecyclePort.record(auditEntry, steps[])` (puerto propio en `@pf/audit/contracts` que envuelve el `AuditPort` compuesto; `AuditEntry.id` opcional aditivo) — ver design.md § Decisiones de implementación 4. Lo usan todos los comandos que cambian estado o editan agregados con máquina: TRANSACTIONS (registro, transferencia, posteo, edición, cleared en lote, des-reconciliación, anulación, conversiones), ACCOUNTS (abrir, actualizar, archivar, cerrar, reactivar, reordenar) y FX manual (registrar, reemplazar; revisión de anomalía como anotación). TC-AUDIT-LIFECYCLE-002 (dobles y PG real con fallo inyectado) y TC-AUDIT-LIFECYCLE-004.
- [x] 3.2 Query `GetLifecycle` en AUDIT con composición de la máquina del contexto dueño y de las queries públicas de revisión/detalle; tests con TC-AUDIT-LIFECYCLE-005, -007, -008, -009, -010
  - 2026-10-04: `LifecycleQueries` en AUDIT + composición por el contexto dueño (`transactionLifecycle` con `revisions[]` desde legs vigentes y reemplazados y `ConversionDetail` por revisión; `accountLifecycle`; `rateLifecycle`). Tests TC-AUDIT-LIFECYCLE-005, -007, -008, -009, -010 en aplicación y API.
- [x] 3.3 Job `audit.lifecycle-backfill` (idempotente, reanudable, `derived = true`, `historyComplete`); tests con TC-AUDIT-LIFECYCLE-011
  - 2026-10-04: deriva los registros de auditoría aún no respaldados (no solo agregados sin transiciones), lotes de 200 por transacción, encolado al arrancar el worker sobre los workspaces activos. TC-AUDIT-LIFECYCLE-011 en memoria y contra PostgreSQL real (dos corridas, la segunda no deriva nada).
- [x] 3.4 Chequeo de consistencia estado ↔ última transición en el invariant checker (FR-LEDGER-015)
  - 2026-10-04: función `audit.lifecycle_state_divergences()` (SECURITY INVOKER + RLS) ejecutada por workspace tras `VerifyLedgerIntegrity` en el job diario; log `error` + métrica `lifecycle_state_divergences_total`; test de API que fuerza una divergencia.

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand `audit.lifecycle_transition` (RLS forzada, grants SELECT/INSERT, `platform.forbid_mutation()`); tests de integración: inmutabilidad (TC-AUDIT-LIFECYCLE-012) y aislamiento entre workspaces (TC-AUDIT-LIFECYCLE-006); registrar la tabla en `platform.workspace_scoped_table` si `add-demo-data` ya existe
  - 2026-10-04: `20261004150000_audit_lifecycle_transition.sql` (RLS forzada, SELECT/INSERT, `forbid_mutation` de fila y sentencia, CHECK por `kind`). TC-AUDIT-LIFECYCLE-012 (pf_app, pf_worker y owner) y TC-AUDIT-LIFECYCLE-006 (RLS; respuesta idéntica a inexistente). `add-demo-data` no está aplicado: el registro en `platform.workspace_scoped_table` queda para ese change.
- [x] 4.2 Consumidor `reporting.data-version` suscrito a `transactions.TransferRevised.v1`; test de idempotencia (reentrega, TC-TRANSACTIONS-TRANSFER-009)
  - 2026-10-04: `REPORTING_INVALIDATING_EVENTS` incluye `transactions.TransferRevised.v1`; reentrega verificada con `EventConsumerRuntime` (`applied` → `duplicate`) en `lifecycle.api.test.ts` (TC-TRANSACTIONS-TRANSFER-009).
  - 2026-10-05 (docs/31 D48): `REPORTING_INVALIDATING_EVENTS` suma `transactions.ConversionRevised.v1`; reentrega `applied` → `duplicate` en `fx-conversions.api.test.ts` (TC-TRANSACTIONS-CONVERSION-012).

## 5. API

- [x] 5.1 Endpoints de lifecycle y de máquinas según design.md § Contratos; tests de API y de contrato (TC-AUDIT-LIFECYCLE-005, -006); schemas de eventos `TransferRevised.v1` y campo `transition` validados con Ajv strict (productor)
  - 2026-10-04: `getTransactionLifecycle`, `getAccountLifecycle`, `getRateLifecycle` (path `fx-rates/{fxRateId}/lifecycle`), `getLifecycleMachine`; schemas `Lifecycle`, `LifecycleTransition`, `LifecycleAnnotation`, `LifecycleMachine` (`to: string[]`), `LifecycleRevision`, `TransactionLifecycle`. Respuestas validadas contra el contrato en los tests de API; oasdiff sin cambios incompatibles. Eventos: `TransferRevised.v1` nuevo, `transition` opcional en 8 schemas, descripción de `TransferCompleted.v1`; validados con el registro Ajv (productor) en los tests.
  - 2026-10-05 (docs/31 D48): schema nuevo `contracts/events/transactions/ConversionRevised.v1.schema.json` (aditivo, con `examples`); el payload del outbox se valida con el registro Ajv en `fx-conversions.api.test.ts`; `ConversionRecorded.v1` cambia solo su `description`.

## 6. UI

- [x] 6.1 Componente `LifecycleReport` (diagrama SVG desde la máquina con camino recorrido numerado, estado actual destacado, no recorridos atenuados; línea de tiempo accesible con enlaces a revisión y asientos; TZ del workspace; i18n es/en/pt preparado) en el detalle de transacción y de cuenta; tests de componentes con TC-AUDIT-LIFECYCLE-013
  - 2026-10-04: `LifecycleReport` en la pestaña "Recorrido" del detalle de transacción y de cuenta (diagrama SVG con layout fijo por máquina, camino numerado, actual destacado, no recorrido atenuado y discontinuo; línea de tiempo accesible con enlaces a revisión y asientos; TZ del workspace; i18n es/en/pt). 10 tests de componente/lógica `[TC-AUDIT-LIFECYCLE-013]` + 004 y 011 en `apps/web/src/ui/lifecycle/lifecycle.test.tsx`. Ver design.md § Decisiones de implementación 13.
- [x] 6.2 Responsive (vertical bajo 768 px) y estado "historia previa incompleta" para recorridos derivados
  - 2026-10-04: layout vertical bajo 768 px (media query entre dos layouts fijos; verificado en E2E a 375 px sin scroll horizontal) y aviso "Historia previa incompleta" + chip "derivada" (TC-AUDIT-LIFECYCLE-011 en el test de componente).

## 7. TESTS automatizados y E2E

- [x] 7.1 E2E Playwright: registrar un gasto pendiente, postearlo, corregirlo y anularlo; abrir "Recorrido" y verificar diagrama y línea de tiempo (TC-AUDIT-LIFECYCLE-013); VIEWER ve el recorrido (TC-AUDIT-LIFECYCLE-006)
  - 2026-10-04: `tests/e2e/specs/lifecycle.spec.ts` verde (2/2), con `transactions.spec` y `accounts.spec` ajustados. Corrido con `PF_E2E_PROJECT=pfos-e2e-lifecycle` y `PF_E2E_PORT_PREFIX=3`: con el prefijo 5 los puertos 55432/56379 estaban ocupados por un contenedor ajeno a PFOS. El 404 de otro workspace se cubre por API (por el BFF un no-miembro recibe 403 del guard). No hay `a11y.spec.ts` en la base del worktree (llega con PR #27): agregar la página "Recorrido" ahí queda para después del rebase.
- [x] 7.2 Agregar TC-TRANSACTIONS-TRANSFER-009 y TC-AUDIT-LIFECYCLE-003 a la Financial Regression Suite
  - 2026-10-04: ambos con `regression_suite: true` (Financial Regression Suite = TCs marcados, docs/16 §11.3) y automatizados.

## 8. DOCUMENTACIÓN y cierre

- [x] 8.1 Actualizar docs/04 (máquinas de estado como lenguaje ubicuo), docs/08 (`audit.lifecycle_transition`), docs/10 (endpoints de lifecycle), docs/11 (`TransferRevised.v1`, semántica de `TransferCompleted`, campo `transition`) y docs/28 (patrón visual "Recorrido")
  - 2026-10-04: docs/04 (glosario + máquinas declaradas en §3.17 y §4.1), docs/08 (`audit.lifecycle_transition` y grants), docs/10 (inventario de recursos), docs/11 (`TransferRevised.v1`, semántica de `TransferCompleted`, campo `transition`) y docs/28 (§6.1 patrón "Recorrido").
  - 2026-10-05 (docs/31 D48): docs/11 (`ConversionRevised.v1`, `ConversionRecorded.v1` una sola vez), docs/04 (`REVISE`), docs/05, docs/14 y `contracts/events/README.md`.
- [x] 8.2 Actualizar estados de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check`
  - 2026-10-04: TC-AUDIT-LIFECYCLE-001..013 y TC-TRANSACTIONS-TRANSFER-009 en `automated` con sus `automated_tests`; `pnpm traceability:check` OK (solo advertencias R3 previas, ajenas); `pnpm traceability:matrix` regenera la matriz (artefacto ignorado por git); `pnpm spec:validate` (`openspec validate --all --strict`) OK.
