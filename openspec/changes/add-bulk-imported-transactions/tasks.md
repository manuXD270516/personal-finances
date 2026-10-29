# Tareas

> Deuda de D152 (persistencia del import ≤ 20 s, NFR-PERF-007). Sin API, UI, eventos ni migraciones. Va después de `optimize-consumer-throughput` y antes de `add-import-pipeline`. Sin Docker en la sesión, `pnpm test:integration` y `pnpm perf:bench` los valida CI (job `integration` y nightly `perf`); se dice en el informe.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `transactions/transaction-recording` e `imports/import-pipeline`; `pnpm exec openspec validate add-bulk-imported-transactions --strict`
- [ ] 1.2 Revisar TC-TRANSACTIONS-BULKIMPORT-001..005 y TC-IMPORTS-PIPELINE-001 (cifras: 4000.00 − 3750.00 + 5000.00 = 5250.00 BOB; 200 × 3 = 600 eventos; 180 + 20 = 200); pasarlos a `ready`

## 2. DOMAIN y APPLICATION (TDD)

- [ ] 2.1 Test por propiedad primero (fast-check, `packages/contexts/transactions/src/application/record-imported-transactions.test.ts`): el lote y el registro individual producen el mismo resultado observable (TC-TRANSACTIONS-BULKIMPORT-005); con repositorios en memoria para el dominio y en integración para la persistencia
- [ ] 2.2 Tests primero de los casos del lote: 200 filas, una fila en periodo cerrado revierte todo con `PERIOD_CLOSED`, 20 referencias existentes (TC-TRANSACTIONS-BULKIMPORT-001, -002, -003)
- [ ] 2.3 Caso de uso `RecordImportedTransactions` detrás de `ImportedTransactionsCommand.recordBatch`: validación por conjunto (cuenta, escala, periodos por fechas distintas, referencias, categorías de sistema) con los mismos objetos de dominio que `recordTransaction`

## 3. INFRASTRUCTURE

- [ ] 3.1 `LedgerPostingPort.postJournalEntries` (contrato aditivo, aplicación e infraestructura por conjunto) con sus tests de contrato; disparadores de integridad activos (un asiento descuadrado inyectado revierte el lote)
- [ ] 3.2 `AuditPort.appendMany` y `LifecyclePort.recordMany` con tests de contrato (rollback ⇒ sin auditoría, INV-029)
- [ ] 3.3 `OutboxPort.appendMany` con validación de envelope y payload por evento (TC de `platform/event-delivery` en verde)
- [ ] 3.4 `TransactionRepository.insertMany` (transacciones, splits, vínculos) con `unnest` tipado; integración con PostgreSQL real: dos lotes concurrentes con las mismas referencias ⇒ una transacción viva por referencia (TC-TRANSACTIONS-BULKIMPORT-004); RLS forzada sin cambios

## 4. TESTS AUTOMATIZADOS

- [ ] 4.1 Suite de imports existente en verde sin cambios (TC-IMPORTS-CSV-001..030), en particular fallo parcial y reintento (TC-IMPORTS-CSV-023, -024)
- [ ] 4.2 TC-IMPORTS-PIPELINE-001: un CSV de 4 filas y uno de 5 000 publican los mismos 2 eventos propios
- [ ] 4.3 `imports.perf.ts`: meta de 20 s por omisión, sin `PF_PERF_STRICT_IMPORT` ni techo de 300 s; test de política (TC-PLATFORM-PIPELINE-028) fijado a 20 s de docs/02

## 5. VERIFICACIÓN

- [ ] 5.1 Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking`, `pnpm test:integration` dos veces seguidas en verde
- [ ] 5.2 Nightly por `workflow_dispatch` sobre la rama y luego dos programados sobre `main`: persistencia ≤ 20 s y drenado ≤ 120 s en TC-IMPORTS-CSV-029; si 200 filas por lote no alcanzan, registrar la medición y la decisión 4 de design.md
- [ ] 5.3 NFR-PERF-003 (registro manual) sin regresión en el nightly

## 6. DOCS y cierre

- [ ] 6.1 Actualizar los docs de design.md § «Cambios a docs compartidos», la nota de TC-IMPORTS-CSV-029 y docs/38 (§3 sin el diferido de D152)
- [ ] 6.2 TC a `automated`; `pnpm traceability:check` y `pnpm exec openspec validate add-bulk-imported-transactions --strict`
