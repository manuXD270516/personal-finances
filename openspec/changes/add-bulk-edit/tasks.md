# Tareas

> Requiere aplicados: `add-transaction-recording`, `add-classification`, `add-audit-trail`, `add-lifecycle-timeline`. Recomendado después de `add-reconciliation` y `add-custom-fields`. Decisión del owner docs/31 D49. Resolver antes la pregunta abierta 1 de design.md (alcance de D49).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `transactions/bulk-edit` y las preguntas abiertas 1–3 de design.md; verificar con `openspec validate add-bulk-edit --strict`
- [ ] 1.2 Revisar TC-TRANSACTIONS-BULK-001..011 contra los scenarios (45.90 + 150.00 + 200.00 = 395.90 BOB); pasar a `ready` y `requirement_status: confirmed` al aprobar

## 2. DOMAIN (TDD)

- [ ] 2.1 `BulkEditChanges` y `BulkApplicability` puros, test-first: categoría solo con un split nominal en income/expense/refund; tags y custom fields a todos los splits; contraparte y notas en cabecera (TC-TRANSACTIONS-BULK-005)
- [ ] 2.2 Test de propiedad: aplicar en lote = aplicar uno a uno con las mismas reglas (mismo estado final) y el ledger no cambia (INV-033, TC-TRANSACTIONS-BULK-004)

## 3. APPLICATION

- [ ] 3.1 `BulkEditTransactions`: carga `FOR UPDATE` ordenada, validación completa con errores por ítem y prioridad de código, aplicación, auditoría por transacción + agregado con `bulkOperationId`, anotaciones/transiciones y outbox en una UoW; test de atomicidad con fallo inyectado (TC-TRANSACTIONS-BULK-001, -003, -007)
- [ ] 3.2 Reglas de periodo cerrado vía `ApplyClassification`/`SetClearedStatus` (TC-TRANSACTIONS-BULK-008) y estado `cleared` (TC-TRANSACTIONS-BULK-006)
- [ ] 3.3 `PreviewBulkEdit` con el motor de filtros de `ListTransactions`, sin efectos (TC-TRANSACTIONS-BULK-002)
- [ ] 3.4 Custom fields en lote cuando `add-custom-fields` esté aplicado (TC-TRANSACTIONS-BULK-010)

## 4. INFRASTRUCTURE

- [ ] 4.1 Inserción multi-row de auditoría y outbox; benchmark de 500 ítems (p95 ≤ 2 s) en el job `perf`
- [ ] 4.2 Campo `bulkOperationId` opcional en los schemas de `TransactionCategorized.v1`, `TransactionUpdated.v1` (y `TransactionCleared.v1`); test de compatibilidad de contrato de eventos

## 5. API

- [ ] 5.1 `bulkEditTransactions` y `previewBulkEditTransactions` en el contrato (`x-required-role: EDITOR`, `Idempotency-Key`, límites), código `BULK_EDIT_NOT_APPLICABLE` en `ErrorCatalog` y mensajes es/en/pt
- [ ] 5.2 Tests de API por TC: límite de 500 e idempotencia (TC-TRANSACTIONS-BULK-009), roles y aislamiento (TC-TRANSACTIONS-BULK-011)

## 6. UI

- [ ] 6.1 Selección múltiple en el registro de transacciones, barra de acciones masivas, diálogo con vista previa obligatoria y resultado con enlace a la auditoría de la operación; i18n es/en/pt

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-TRANSACTIONS-BULK-001..011 con el TC-ID en el nombre; actualizar front matter
- [ ] 7.2 E2E: recategorizar y etiquetar tres gastos con vista previa (TC-TRANSACTIONS-BULK-001)

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar docs/10 §12 (modo único `ALL_OR_NOTHING`, vista previa), docs/11 (`bulkOperationId` aditivo), docs/01 FR-TRANSACTIONS-033 y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
