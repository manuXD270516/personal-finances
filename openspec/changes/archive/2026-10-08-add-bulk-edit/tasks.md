# Tareas

> Requiere aplicados: `add-transaction-recording`, `add-classification`, `add-audit-trail`, `add-lifecycle-timeline`. Recomendado después de `add-reconciliation` y `add-custom-fields`. Decisión del owner docs/31 D49. Resolver antes la pregunta abierta 1 de design.md (alcance de D49).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `transactions/bulk-edit` y las preguntas abiertas 1–3 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-bulk-edit --strict`
  - 2026-10-08: revisado con el owner; las preguntas abiertas 1–3 de design.md quedaron resueltas en docs/33: D65 (alcance de la edición en periodos cerrados, extensión de D49), D94 (sin `BEST_EFFORT` ni asíncrono > 500 en Phase 2) y D95 (sin deshacer; se revierte con otra edición masiva), más D111 (la edición masiva no toca `systemFlags`); `openspec validate add-bulk-edit --strict` verde (`pnpm spec:validate`).
- [x] 1.2 Revisar TC-TRANSACTIONS-BULK-001..011 contra los scenarios (45.90 + 150.00 + 200.00 = 395.90 BOB); pasar a `ready` y `requirement_status: confirmed` al aprobar
  - 2026-10-08: TC-TRANSACTIONS-BULK-001..011 revisados contra los scenarios (45.90 + 150.00 + 200.00 = 395.90 BOB en los tests de aplicación, API y E2E); pasan a `automated` con sus tests, igual que TC-PLANNING-LOCK-004 (el paso de edición masiva en periodo cerrado que quedó pendiente de este change).

## 2. DOMAIN (TDD)

- [x] 2.1 `BulkEditChanges` y `BulkApplicability` puros, test-first: categoría solo con un split nominal en income/expense/refund; tags y custom fields a todos los splits; contraparte y notas en cabecera (TC-TRANSACTIONS-BULK-005)
  - 2026-10-08: `domain/bulk-edit.ts` (`parseBulkEditChanges`, `bulkApplicability`, `applyBulkToSplits`, `splitKindOf`) y `Transaction.bulkEdit` (clasificación + `cleared` en UNA versión nueva); tests en `domain/bulk-edit.test.ts` (TC-TRANSACTIONS-BULK-004, -005: categoría solo con un split nominal de ingreso/gasto/reembolso, tags a todos los splits, contraparte y notas en cabecera).
- [x] 2.2 Test de propiedad: aplicar en lote = aplicar uno a uno con las mismas reglas (mismo estado final) y el ledger no cambia (INV-033, TC-TRANSACTIONS-BULK-004)
  - 2026-10-08: propiedad con fast-check (`domain/bulk-edit.test.ts`): aplicar en lote = aplicar cada cambio por separado (mismo estado final salvo la versión) y montos, legs, fecha, revisión y asiento activo no cambian (INV-033, TC-TRANSACTIONS-BULK-004).

## 3. APPLICATION

- [x] 3.1 `BulkEditTransactions`: carga `FOR UPDATE` ordenada, validación completa con errores por ítem y prioridad de código, aplicación, auditoría por transacción + agregado con `bulkOperationId`, anotaciones/transiciones y outbox en una UoW; test de atomicidad con fallo inyectado (TC-TRANSACTIONS-BULK-001, -003, -007)
  - 2026-10-08: `BulkEditService.bulkEdit` (application/bulk-edit.service.ts): `FOR UPDATE` ordenado por id (`findMany`), validación completa con errores por ítem y prioridad de código 404 > 412 > 409 > 422, aplicación en memoria, escritura en lote, auditoría por transacción + agregada con `bulkOperationId` como `correlation_id`, anotaciones/transiciones y outbox en una UoW; test de atomicidad con fallo inyectado en el registro agregado (TC-TRANSACTIONS-BULK-001, -003, -007).
- [x] 3.2 Reglas de periodo cerrado vía `ApplyClassification`/`SetClearedStatus` (TC-TRANSACTIONS-BULK-008) y estado `cleared` (TC-TRANSACTIONS-BULK-006)
  - 2026-10-08: alcance de D65 por ítem con `LedgerService.assertPeriodOpen` (una consulta por fecha distinta): categoría, tags, contraparte, custom fields y `cleared` ⇒ `PERIOD_CLOSED`; notas permitidas; una `PENDING` no se edita en periodo cerrado (D69), igual que la edición individual (TC-TRANSACTIONS-BULK-006, -008, TC-PLANNING-LOCK-004). `cleared` reutiliza las reglas de `markCleared` dentro de `Transaction.bulkEdit`.
- [x] 3.3 `PreviewBulkEdit` con el motor de filtros de `ListTransactions`, sin efectos (TC-TRANSACTIONS-BULK-002)
  - 2026-10-08: `BulkEditService.preview` con el motor de filtros de `ListTransactions` (`selection.filter`) o ids explícitos, sin efectos (sin auditoría ni versiones nuevas), hasta 500 con `truncated` (TC-TRANSACTIONS-BULK-002).
- [x] 3.4 Custom fields en lote cuando `add-custom-fields` esté aplicado (TC-TRANSACTIONS-BULK-010)
  - 2026-10-08: custom fields en lote validados una vez por combinación de campos existentes con `ValidateCustomFieldValues` (`requireMandatory`, como la edición individual) y aplicados a todos los splits; `CUSTOM_FIELD_VALUE_INVALID`/`CUSTOM_FIELD_ARCHIVED` rechazan todo (TC-TRANSACTIONS-BULK-010). Se identifican por `fieldId` o `key`.

## 4. INFRASTRUCTURE

- [x] 4.1 Inserción multi-row de auditoría y outbox; benchmark de 500 ítems (p95 ≤ 2 s) en el job `perf`
  - 2026-10-08: `PgTransactionRepository.findMany`/`updateClassificationBatch` (sentencias multi-fila), `AuditPort.appendMany`, `LifecyclePort.recordMany` y `OutboxWriter.appendMany` (sin migraciones); benchmark `bulk-edit-500` en el job `perf` (`apps/api/test/perf/nightly.perf.ts`): p50 ≈ 0,87 s y máx. ≈ 0,99 s por operación de 500 ítems (umbral 2 s); antes de los inserts multi-fila eran ≈ 2,3 s.
- [x] 4.2 Campo `bulkOperationId` opcional en los schemas de `TransactionCategorized.v1`, `TransactionUpdated.v1` (y `TransactionCleared.v1`); test de compatibilidad de contrato de eventos
  - 2026-10-08: `bulkOperationId` opcional (uuid) en los schemas de `TransactionCategorized.v1` y `TransactionUpdated.v1` con ejemplos; `TransactionCleared.v1` ya lo llevaba (sin versión nueva); el test de compatibilidad de eventos (`event-contracts`) y la validación de cada evento en los tests de API pasan.

## 5. API

- [x] 5.1 `bulkEditTransactions` y `previewBulkEditTransactions` en el contrato (`x-required-role: EDITOR`, `Idempotency-Key`, límites), código `BULK_EDIT_NOT_APPLICABLE` en `ErrorCatalog` y mensajes es/en/pt
  - 2026-10-08: `bulkEditTransactions` y `previewBulkEditTransactions` en el contrato (`x-required-role: EDITOR`, `Idempotency-Key` en la ejecución, `maxItems: 500`, `additionalProperties: false`), código `BULK_EDIT_NOT_APPLICABLE` (422) en `ErrorCatalog`, en `ErrorCode` y en `errors.{es,en,pt}.json`; Spectral 0 errores, Redocly válido y `pnpm contract:breaking` sin rupturas. Desviaciones: `count` en lugar de `total` (la regla Spectral `pfos-money-via-schema` reserva `total`), la vista previa queda exenta de `Idempotency-Key` como `previewConversion`/`checkTransactionDuplicates`, y el bucket de rate limit de 10/min no existe en la plataforma (cuenta como una escritura más).
- [x] 5.2 Tests de API por TC: límite de 500 e idempotencia (TC-TRANSACTIONS-BULK-009), roles y aislamiento (TC-TRANSACTIONS-BULK-011)
  - 2026-10-08: `apps/api/test/api/bulk-edit.api.test.ts` contra PostgreSQL real: límite de 500 e idempotencia (TC-TRANSACTIONS-BULK-009), roles y aislamiento entre workspaces (TC-TRANSACTIONS-BULK-011) y el resto de los TC por HTTP; ráfaga de 500 con los consumidores de presupuestos (umbral emitido una sola vez) y de reporting idempotentes ante la reentrega.

## 6. UI

- [x] 6.1 Selección múltiple en el registro de transacciones, barra de acciones masivas, diálogo con vista previa obligatoria y resultado con enlace a la auditoría de la operación; i18n es/en/pt
  - 2026-10-08: registro de transacciones (`TransactionsPage`/`BulkEditPanel`): selección múltiple (también pendientes y conciliadas), "seleccionar todo lo filtrado (hasta 500)", barra con recategorizar/etiquetar/contraparte/estado, vista previa obligatoria con no aplicables y motivo, "quitar las que no se pueden editar", resultado con el `bulkOperationId` y errores por ítem; i18n es/en/pt. Pendiente de la UI: el enlace a la auditoría filtrada por operación depende de `add-global-audit-view` (hoy se muestra el identificador).

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar TC-TRANSACTIONS-BULK-001..011 con el TC-ID en el nombre; actualizar front matter
  - 2026-10-08: TC-TRANSACTIONS-BULK-001..011 automatizados con el TC-ID en el nombre (dominio, aplicación, API, UI y E2E) y front matter actualizado (`automation_status: automated`); TC-PLANNING-LOCK-004 también.
- [x] 7.2 E2E: recategorizar y etiquetar tres gastos con vista previa (TC-TRANSACTIONS-BULK-001)
  - 2026-10-08: `tests/e2e/specs/bulk-edit.spec.ts` (stack `pfos-e2e-bulk`, prefijo 4): recategorizar y etiquetar tres gastos con vista previa, gasto dividido señalado y quitado de la selección, versión obsoleta con error por ítem, "todo lo filtrado" con confirmación, axe sin violaciones serias y sin scroll horizontal a 360 px.

## 8. DOCUMENTATION

- [x] 8.1 Actualizar docs/10 §12 (modo único `ALL_OR_NOTHING`, vista previa), docs/11 (`bulkOperationId` aditivo), docs/01 FR-TRANSACTIONS-033 y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
  - 2026-10-08: docs/10 §12 (modo único `ALL_OR_NOTHING`, vista previa, prioridad de códigos, `BULK_EDIT_NOT_APPLICABLE`), docs/11 (`bulkOperationId` aditivo), docs/01 FR-TRANSACTIONS-033 y design.md alineados; `pnpm spec:validate` y `pnpm traceability:check` verdes.
