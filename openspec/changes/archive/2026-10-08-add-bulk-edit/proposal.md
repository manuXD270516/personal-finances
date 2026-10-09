# Propuesta: add-bulk-edit

## Why

Ordenar el mes (recategorizar las compras del supermercado, etiquetar los gastos de un viaje, asignar la contraparte correcta a varias transacciones o confirmar contra el extracto) hoy exige editar transacción por transacción. FR-TRANSACTIONS-033 (Phase 2, `transactions/bulk-edit`) pide edición masiva sobre una selección o filtro con vista previa, ejecución atómica, un `AuditLog` por transacción y un `bulkOperationId` común, sin tocar montos, cuentas ni fechas. El marcado `cleared` en lote de Phase 1 ya fijó la semántica todo o nada con versión por ítem; este change la generaliza a la clasificación respetando la decisión D49 (no se recategoriza en periodos cerrados) y el principio INV-033 (clasificar nunca toca el ledger).

## What Changes

- **Edición masiva** (`POST W/transactions/bulk-edit`) sobre hasta 500 transacciones explícitas, cada una con su versión esperada (equivalente a `If-Match` por ítem): cambiar categoría (transacciones con un único split nominal), agregar/quitar tags (en todos sus splits), fijar o quitar contraparte, reemplazar notas, marcar/desmarcar `cleared` y fijar/quitar valores de custom fields (cuando `add-custom-fields` esté aplicado).
- **Vista previa** sin efectos (`POST W/transactions/bulk-edit/preview`) a partir de una selección o de los mismos filtros del listado: cantidad afectada, versiones vigentes y, por ítem, si el cambio es aplicable y por qué no.
- **Todo o nada**: cualquier ítem inválido, no aplicable, en periodo cerrado o con versión obsoleta rechaza la operación completa con un error por ítem; nada cambia.
- **Sin cambios financieros**: el request no admite monto, cuenta, fecha, moneda ni splits; el ledger no cambia (INV-033). Anular en lote sigue sin ofrecerse (docs/10 §12).
- **Auditoría**: un registro por transacción cambiada con `bulkOperationId` común más un registro agregado de la operación; eventos por transacción (`TransactionCategorized.v1`, `TransactionUpdated.v1`, `TransactionCleared.v1`) con `bulkOperationId` aditivo; anotaciones/transiciones del recorrido por transacción.
- **Periodos cerrados**: cambios de clasificación o de estado sobre transacciones con fecha en un periodo cerrado ⇒ `PERIOD_CLOSED` (D49).
- **Fuera de alcance:** modo `BEST_EFFORT` y ejecución asíncrona (> 500 ítems o por filtro sin vista previa, `202` + operation) — quedan para una fase posterior; anular, postear o des-reconciliar en lote; cambios financieros en lote; reglas automáticas (Phase 6); fusión de categorías/contrapartes (FR-CLASSIFICATION-007/013, Could).

## Capabilities

### New Capabilities
- `transactions/bulk-edit`: edición masiva de clasificación y estado `cleared` con vista previa, ejecución todo o nada, versión por ítem, auditoría con `bulkOperationId`, respeto de periodos cerrados, límites, idempotencia y control por rol.

### Modified Capabilities
- Ninguna (reutiliza las reglas de `transactions/reconciliation` para `cleared` y de `classification/*` para la validez de categorías, tags y contrapartes sin modificarlas).

## Impact

**Specs impactadas:** crea `transactions/bulk-edit` (11 requirements: 5 Must, 6 Should).

**Componentes/contextos impactados:** TRANSACTIONS (`@pf/transactions`): comando `BulkEditTransactions` y query `PreviewBulkEdit` (application), reutilizando `ApplyClassification`, `SetClearedStatus` y el validador de clasificación por `ClassificationValidator`; `apps/api` (controller) y `apps/web` (selección múltiple en el registro, barra de acciones masivas, diálogo con vista previa y resultado).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nuevas `bulkEditTransactions` (`POST W/transactions/bulk-edit`) y `previewBulkEditTransactions` (`POST W/transactions/bulk-edit/preview`); schemas `BulkEditRequest`, `BulkEditChanges`, `BulkEditPreviewRequest`, `BulkEditPreview`, `BulkEditResult`; nuevo código `BULK_EDIT_NOT_APPLICABLE` (422). El campo `mode` de docs/10 §12 queda fijo en `ALL_OR_NOTHING` en Phase 2.

**Tablas impactadas:** ninguna nueva. Escribe en `txn.transaction`, `txn.transaction_split`, `txn.split_tag` (y `txn.split_custom_field_value` si `add-custom-fields` está aplicado), `audit.audit_log`, `audit.lifecycle_transition`, `platform.outbox`, `platform.idempotency_key`. El `bulkOperationId` se guarda como en el lote `cleared` de Phase 1 (entrada `bulkOperationId` en `changes` de cada `audit.audit_log`) y además es el `correlation_id` de todos los registros de la operación (sin columna nueva; design.md decisión 6).

**Eventos impactados:** `transactions.TransactionCategorized.v1` y `transactions.TransactionUpdated.v1` con campo opcional aditivo `bulkOperationId`; `transactions.TransactionCleared.v1` (de `add-reconciliation`) con `bulkOperationId`.

**Migraciones requeridas:** ninguna de schema. El índice `(workspace_id, correlation_id)` de `audit.audit_log` para filtrar por operación lo crea `add-global-audit-view`.

**Invariantes afectadas:** INV-015 (periodos cerrados), INV-019 (no asignar catálogos archivados), INV-027 (idempotencia), INV-029 (auditoría atómica), INV-033 (clasificar no toca el ledger).

**Test cases:** AÑADIDOS — TC-TRANSACTIONS-BULK-001..011 (`draft`/`ready`, `not_automated`). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** reutiliza `ApplyClassification` y `SetClearedStatus`; cualquier cambio en esas reglas debe pasar los TC de Phase 1 (TC-TRANSACTIONS-CLEARED-002, TC-CLASSIFICATION-RECATEGORIZE-*) y los de este change. No toca el traductor de postings.

**Riesgos introducidos:** latencia de una operación de 500 ítems en una sola transacción de BD (objetivo p95 ≤ 2 s, design.md); bloqueos largos sobre filas de transacciones durante la operación; error humano al aplicar un cambio masivo equivocado (mitigado con vista previa obligatoria en la UI y auditoría con `bulkOperationId` para revertir manualmente).
