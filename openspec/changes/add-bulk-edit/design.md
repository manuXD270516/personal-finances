# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Este change crea la capability `transactions/bulk-edit` del contexto **TRANSACTIONS** (`@pf/transactions`), prevista en ARCHITECTURE §14, docs/04 §3.4 (comando `BulkEditTransactions`), docs/10 §12 (endpoint `POST W/transactions/bulk-edit`) y §14 (EDITOR/OWNER), y FR-TRANSACTIONS-033. Reutiliza la semántica del lote `cleared` de Phase 1 (`markTransactionsCleared`: todo o nada, versión por ítem, `bulkOperationId` en cada `AuditLog`) y las reglas de clasificación de `classification/*` (D49: `PERIOD_CLOSED` al recategorizar en periodo cerrado; INV-019; INV-033).

Capas afectadas:

| Capa | Cambios |
|---|---|
| domain | Sin agregados nuevos. VO `BulkEditChanges` (categoría, `addTagIds`, `removeTagIds`, contraparte `set|clear`, notas `replace`, `cleared: boolean`, `customFields[]`); regla pura `BulkApplicability` (por ítem: aplicable o motivo). Los cambios se aplican con los métodos existentes del agregado `Transaction` (`applyClassification`, `setCleared`, `updateDescriptive`). |
| application | Comando `BulkEditTransactions` (una UoW: carga con `SELECT … FOR UPDATE` ordenado por id para evitar deadlocks, valida todo antes de mutar, aplica, audita, registra anotaciones/transiciones y outbox); query `PreviewBulkEdit` (sin efectos; resuelve filtro → ids con el mismo motor de `ListTransactions`). |
| infrastructure | Sin migraciones. Inserción en lote de auditoría y outbox (multi-row `INSERT`). |
| interface | Controller `transactions/bulk-edit` y `…/preview`; UI: selección múltiple en el registro (casillas + "seleccionar todo lo filtrado" hasta 500), barra de acciones, diálogo con vista previa obligatoria (cantidad, no aplicables) y resultado con enlace a la auditoría filtrada por operación. |

Puertos: `ClassificationValidator` (categorías/tags/contrapartes activas y tipo), `CustomFieldValidator` (de `add-custom-fields`, opcional según orden de aplicación), `PeriodLockQuery` (ledger), `AuditPort`, `LifecyclePort`.

## Objetivos / No objetivos

**Objetivos:** FR-TRANSACTIONS-033 en modo todo o nada síncrono hasta 500 ítems, con vista previa y auditoría por transacción.

**No objetivos:** `BEST_EFFORT`, ejecución asíncrona (`202` + operation), anular/postear/des-reconciliar en lote, cambios financieros, deshacer automático de una operación masiva.

## Decisiones

1. **Solo `ALL_OR_NOTHING`.** docs/10 §12 contempla `BEST_EFFORT`; en Phase 2 el request no acepta `mode` (o solo `ALL_OR_NOTHING`) para mantener una sola semántica, igual que el lote `cleared`. Alternativa diferida (pregunta 2).
2. **Selección explícita con versión por ítem** (`items: [{ id, version }]`, `minItems 1`, `maxItems 500`, `uniqueItems`). La versión en el cuerpo es el equivalente por ítem de `If-Match` (no hay un `ETag` único para N recursos); versión obsoleta ⇒ 412 `PRECONDITION_FAILED` con `errors[]` por ítem. Filtros solo en la vista previa, que devuelve los `{id, version}` a enviar: así la ejecución nunca afecta transacciones que el usuario no vio.
3. **Validación completa antes de mutar**: se evalúan todos los ítems y se devuelven **todos** los errores (no solo el primero), con prioridad de código: 404 > 403 > 412 > 409 (`PERIOD_CLOSED`, `INVALID_STATUS_TRANSITION`, `TRANSACTION_RECONCILED`, `CATEGORY_ARCHIVED`…) > 422 (`BULK_EDIT_NOT_APPLICABLE`, `CATEGORY_KIND_MISMATCH`, `CUSTOM_FIELD_VALUE_INVALID`). El `status` HTTP es el del error de mayor prioridad; `errors[]` lleva `code` por ítem (`pointer: /items/<i>`).
4. **Aplicabilidad.** Categoría: solo `INCOME|EXPENSE|REFUND` con exactamente un split nominal vigente (docs/10 §12 "categoría de split único"); `TRANSFER`/`CONVERSION` (solo splits de fee) y multi-split ⇒ `BULK_EDIT_NOT_APPLICABLE`. Tags y custom fields: todos los splits nominales vigentes. Contraparte y notas: cabecera de la transacción (cualquier kind). `cleared`: reglas de `SetClearedStatus`.
5. **Periodos cerrados**: categoría, tags, contraparte, custom fields y `cleared` sobre transacciones con `business_date` en un mes bloqueado ⇒ `PERIOD_CLOSED`. Notas (texto libre sin efecto en reportes ni presupuestos) quedan permitidas, igual que en la edición individual. Para tags, contraparte y custom fields es una extensión de D49 (pregunta abierta 1).
6. **`bulkOperationId`** (UUIDv7) se genera por operación, se usa como `correlation_id` de todos los `audit.audit_log` de la operación y se agrega como entrada `changes[{ field: 'bulkOperationId' }]` en cada registro por transacción (formato as-built del lote `cleared`). Registro agregado: `action = transactions.transaction.bulk_edited`, `aggregate_type = 'TransactionBulkOperation'`, `aggregate_id = bulkOperationId`, `changes` con la cantidad y los cambios solicitados (sin la lista completa de ids si > 50: se reconstruye por `correlation_id`).
7. **Eventos**: por transacción, `TransactionCategorized.v1` si cambió categoría/tags (`appliedBy=USER`), `TransactionUpdated.v1` con `changedFields` (contraparte, notas, customFields, status) y `TransactionCleared.v1` si cambió `cleared` (requiere `add-reconciliation`; antes de él se publica solo `TransactionUpdated`); todos con `bulkOperationId` opcional aditivo. Recorrido: anotación por transacción (clasificación) y transición `CLEAR`/`UNCLEAR`.
8. **Idempotencia**: `Idempotency-Key` obligatorio en ejecución (no en la vista previa); la respuesta almacenada incluye `bulkOperationId` y versiones resultantes.
9. **Rendimiento**: objetivo p95 ≤ 2 s para 500 ítems con 3 cambios (una transacción BD, `FOR UPDATE` ordenado, inserts multi-row). `lock_timeout` 5 s ⇒ 409 `CONCURRENCY_CONFLICT` reintentable.
10. **Rate limit**: cuenta como escritura costosa (bucket de exports/imports, 10/min, docs/10 §10) para evitar abuso.

### Contratos (OpenAPI)

| Operación | Ruta | Rol | Request / respuesta |
|---|---|---|---|
| `previewBulkEditTransactions` | `POST W/transactions/bulk-edit/preview` | EDITOR | `{ selection: { items: [{id}] } | { filter: TransactionListFilter }, changes: BulkEditChanges }` ⇒ 200 `{ total, truncated: boolean, items: [{ id, version, applicable, reasons: [code] }] }` (máx. 500; `truncated` si el filtro devuelve más) |
| `bulkEditTransactions` | `POST W/transactions/bulk-edit` | EDITOR | `{ items: [{ id, version }], changes: BulkEditChanges }`; `Idempotency-Key`; 200 `{ bulkOperationId, data: Transaction[] }`; 400/404/409/412/422 con `errors[]` por ítem |

`BulkEditChanges` (`additionalProperties: false`, `minProperties: 1`): `categoryId`, `addTagIds[]`, `removeTagIds[]`, `counterpartyId` (uuid o `null` = quitar), `notes` (string o `null`), `cleared` (boolean), `customFields: [{ fieldId, value | null }]`. Cualquier otra propiedad (`amount`, `accountId`, `businessDate`, `splits`, `status`…) ⇒ 400 `VALIDATION_FAILED` por el validador de contrato. Código nuevo `BULK_EDIT_NOT_APPLICABLE` (422).

## Riesgos / Trade-offs

- **Bloqueo de hasta 500 filas** en una transacción: aceptable con un usuario; `lock_timeout` evita esperas largas.
- **Error humano masivo**: mitigado con vista previa obligatoria en la UI, versión por ítem y auditoría filtrable por `bulkOperationId` (`add-global-audit-view`) para revertir manualmente; no se ofrece "deshacer" automático (pregunta 3).
- **Desalineación con la edición individual** si las reglas de periodo cerrado difieren: ambos caminos usan el mismo `ApplyClassification`, que es el único lugar donde vive la regla.

## Plan de migración

Sin migraciones de schema. Contrato: dos operaciones nuevas y un código (MINOR). Eventos: campo opcional aditivo `bulkOperationId` (sin versión nueva). Rollback: la versión anterior simplemente no expone los endpoints.

## Preguntas abiertas

1. **Alcance de D49.** ¿El rechazo `PERIOD_CLOSED` en periodo cerrado aplica también a tags, contraparte y custom fields (no solo a la categoría)? **Recomendación:** sí, porque alimentan reportes y presupuestos por tag/contraparte (pf-p2b); notas libres permitidas. Debe aplicarse igual en la edición individual (`ApplyClassification`).
2. **Modo `BEST_EFFORT` y asíncrono > 500.** ¿Se necesitan en Phase 2? **Recomendación:** no; se evaluará con imports (Phase 6), donde los lotes grandes son reales.
3. **Deshacer una operación masiva.** ¿Se ofrece "deshacer" (aplicar el diff inverso por `bulkOperationId`)? **Recomendación:** no en Phase 2; la auditoría filtrada por operación permite revertir con otra edición masiva.

## Dependencias entre changes

- **Requiere aplicados:** `add-transaction-recording`, `add-classification`, `add-audit-trail`, `add-lifecycle-timeline` (Phase 1).
- **Recomendado antes:** `add-reconciliation` (evento `TransactionCleared.v1` para `cleared` en lote) y `add-custom-fields` (requirement "Custom fields en la edición masiva"; sin él ese requirement queda inactivo y su TC pendiente).
- **Coordina con pf-p2a** (`planning/financial-periods`): `PERIOD_CLOSED` depende de `ledger.period_lock`, que escribe el cierre de mes; sin cierres implementados el chequeo es inocuo.
- **Coordina con pf-p2b** (`planning/budgets`, `notifications/alerts`): una recategorización masiva cambia los actuales de presupuesto (INV-034) y puede disparar alertas de umbral; los consumidores de `TransactionCategorized.v1` deben ser idempotentes y tolerar ráfagas de hasta 500 eventos.
- **Lo consume:** `add-global-audit-view` (filtro por operación masiva).
