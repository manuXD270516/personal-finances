# Tareas

> DESIGN GATE aprobado el 2026-10-01. Requiere aplicados: `bootstrap-platform-foundation`, `add-workspace-identity`, `add-api-conventions`, `add-audit-trail`, `add-accounts-management`, `add-ledger-core`, `add-classification` (ver design.md § Dependencias).

## 1. SPEC y test cases

- [ ] 1.1 Revisar con el owner las preguntas abiertas de design.md (ajuste informativo en cero, `reconciled→void`, sobre-reembolso, evento `TransactionCleared`); verificar que las respuestas quedan reflejadas en las specs y que `openspec validate add-transaction-recording --strict` pasa
- [ ] 1.2 Confirmar los TC listados en proposal.md (estado `ready`, `requirement` exacto); verificar con el chequeo del catálogo de `scripts/traceability` que no hay requirement Must sin TC
- [ ] 1.3 Aplicar en `contracts/openapi/finance-api.v1.yaml` y `contracts/events/` los cambios de design.md § Contratos (o confirmar que el proceso de consolidación los aplicó); verificar Redocly lint 0/0 y la meta-validación de los JSON Schema con sus `examples`

## 2. DOMAIN (TDD obligatorio: lógica financieramente crítica)

- [ ] 2.1 Escribir primero los tests de `TransactionStatus` (transiciones de FR-TRANSACTIONS-006, TC-TRANSACTIONS-STATUS-001) y luego implementar la máquina de estados; verificar con PBT de secuencias aleatorias de comandos (INV-023)
- [ ] 2.2 TDD del agregado `Transaction`: creación income/expense/refund/adjustment, moneda = moneda de cuenta, monto positivo y escala (TC-TRANSACTIONS-CURRENCY-001, AMOUNT-001, AMOUNT-002); verificar que los errores de dominio usan los códigos del catálogo
- [ ] 2.3 TDD de splits: ≥ 1 split, default *Uncategorized*, Σ splits exacta, splits supersedidos por revisión (TC-TRANSACTIONS-SPLIT-001, SPLIT-002, SPLIT-004); verificar PBT de INV-021
- [ ] 2.4 TDD de `TransactionPostingTranslator` para INCOME, EXPENSE, REFUND, ADJUSTMENT (docs/09 §6.1–§6.6); verificar con PBT que todo asiento cuadra por moneda (INV-004) y que legs = postings de cuentas de usuario (INV-024)
- [ ] 2.5 TDD de amend (financiero vs descriptivo), void, cleared/reconciled/unreconcile y protección de reconciliadas (TC-TRANSACTIONS-EDIT-001, EDIT-002, VOID-001, RECONCILED-001..003); verificar que una edición descriptiva nunca produce drafts de asiento (INV-033)
- [ ] 2.6 TDD de reglas de reembolso (vínculo, exceso con confirmación) y ajuste (motivo, dirección) (TC-TRANSACTIONS-REFUND-001, REFUND-002, ADJUSTMENT-001)
- [ ] 2.7 Implementar `DuplicateDetector` puro con tests de ventana ±3 días, cuenta, monto y similitud (TC-TRANSACTIONS-DUPLICATE-001); verificar casos borde de acentos y mayúsculas

## 3. APPLICATION

- [ ] 3.1 Implementar comandos `RecordTransaction`, `RecordRefund`, `RecordAdjustment`, `PostTransaction` con Unit of Work (agregado + `LedgerPostingPort` + `AuditPort` + outbox en una transacción); verificar con TC-TRANSACTIONS-POSTING-001 (falla inyectada ⇒ rollback total) y TC-TRANSACTIONS-PENDING-001
- [ ] 3.2 Implementar `AmendTransaction`, `ApplyClassification`, `VoidTransaction` con `reverseEntry` y validación de cuentas no activas (INV-026); verificar TC-TRANSACTIONS-ARCHIVED-001 y SPLIT-005
- [ ] 3.3 Implementar `SetClearedStatus` (individual y lote all-or-nothing con `bulkOperationId`), `MarkReconciled`, `UnreconcileTransaction`; verificar TC-TRANSACTIONS-CLEARED-001, CLEARED-002
- [ ] 3.4 Implementar queries `GetTransaction`, `ListTransactions` (filtros, subcategorías, cursor) y `CheckDuplicates`; verificar TC-TRANSACTIONS-LIST-001
- [ ] 3.5 Emitir `TransactionCreated`, `TransactionPosted`, `TransactionVoided`, `TransactionCategorized`, `TransactionUpdated` según design.md § Eventos; verificar con tests de contrato del productor (Ajv strict) contra `contracts/events/transactions/*`

## 4. INFRASTRUCTURE

- [ ] 4.1 Escribir la migración `txn_0001_transactions_core` (schema `txn`, tablas, CHECKs de INV-023, constraint trigger diferido de Σ splits, índices, `unaccent`/`pg_trgm`, grants sin DELETE, RLS por `workspace_id`); verificar con test de migración y test de catálogo PG (sin FKs cross-schema, sin `timestamp without time zone`)
- [ ] 4.2 Implementar `TransactionRepository` (Kysely, montos como string, optimistic locking por `version`); verificar con tests de integración Testcontainers incluido el test concurrente de dos escritores (NFR-DATA-014)
- [ ] 4.3 Verificar aislamiento: tests RLS con dos workspaces (INV-025) y que `pf_app` no puede borrar filas de `txn.*` ni modificar `txn.transaction_journal_link`

## 5. API

- [ ] 5.1 Implementar controllers `createTransaction` (con `warnings[]`), `getTransaction`, `listTransactions`, `updateTransaction`, `voidTransaction`, `postTransaction`, `markTransactionsCleared`, `unreconcileTransaction`, `checkTransactionDuplicates` con `x-required-role`; verificar contract tests contra el OpenAPI
- [ ] 5.2 Verificar `If-Match`/`ETag` (412/428/409) y `Idempotency-Key` con TC-TRANSACTIONS-CONCURRENCY-001 y TC-TRANSACTIONS-IDEMPOTENCY-001; verificar problem+json con `errors[].pointer` en TC-TRANSACTIONS-AMOUNT-001
- [ ] 5.3 Verificar TC-TRANSACTIONS-FIELDS-001, DATES-001 y HISTORY-001 a nivel API (historial vía `GET W/audit-log`)

## 6. UI

- [ ] 6.1 Formulario de transacción (ingreso/gasto/reembolso/ajuste) con entrada de montos tolerante al locale (NFR-USAB-003), splits con reparto por porcentaje/partes iguales usando la regla compartida, advertencia de duplicados no bloqueante; verificar con tests de componente y axe sin violaciones serious/critical
- [ ] 6.2 Registro de transacciones con filtros, búsqueda, marcado `cleared` individual y en lote, y detalle con historial, anular, des-reconciliar y "duplicar"; verificar en viewport móvil 360 px (NFR-USAB-006)
- [ ] 6.3 Copys en español mapeados por `code` de error (sin mostrar `title` técnico); verificar que todos los códigos de este change tienen copy

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Asegurar que cada TC del change tiene al menos un test con `[TC-…]` al inicio del nombre y actualizar `automation_status`/`automated_tests`; verificar con la matriz de trazabilidad
- [ ] 7.2 E2E Playwright: registrar un gasto dividido, editar su monto, marcarlo cleared y anular otro, comprobando saldos en pantalla; verificar en CI con el stack `core`
- [ ] 7.3 Benchmark de NFR-PERF-001 (listado 50k) y NFR-PERF-003 (comando de escritura); verificar p95 dentro de umbral en el job nightly

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/01 (pregunta abierta 1 resuelta), docs/08 §5.4 (columnas añadidas), docs/10 §9.1 (códigos nuevos) y docs/11 (`TransactionUpdated.v1` en Phase 1); verificar enlaces
- [ ] 8.2 Regenerar la matriz de trazabilidad, actualizar estados de los TC y ejecutar `openspec validate --all --strict --no-interactive`; verificar que pasa antes de archivar el change
