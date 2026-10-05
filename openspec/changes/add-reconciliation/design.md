# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Este change completa la capability `transactions/reconciliation` del contexto **TRANSACTIONS** (`@pf/transactions`, schema `txn`) según docs/04 §3.4 (AR `Reconciliation`, comandos `StartReconciliation`, `ToggleCleared`, `CompleteReconciliation`, `UnreconcileTransaction`; query `GetClearedBalance`), docs/08 §5.4 (`txn.reconciliation`, `txn.reconciliation_item`, "Phase 2, aún no creadas"), docs/09 §9–§11, docs/10 §13 (recurso `reconciliations`, Phase 2) y las decisiones docs/31 D16 (reconciled → void exige des-reconciliar), D37 (máquina de estados y transición por cambio), D47 (evento dedicado `TransactionCleared` en Phase 2) y D49 (periodo cerrado ⇒ `PERIOD_CLOSED` en la recategorización).

Capas afectadas:

| Capa | Cambios |
|---|---|
| domain | AR `Reconciliation` (`id, workspaceId, accountId, currency, statementDate, statementBalance, status IN_PROGRESS|COMPLETED|CANCELLED, clearedBalanceAtCompletion?, adjustmentTransactionId?, completedAt?, cancelledAt?, version`), máquina `RECONCILIATION_LIFECYCLE` (machineVersion 1). Servicio puro `ReconciliationCalculator` (saldo confirmado y diferencia; signo por naturaleza de la cuenta). `Transaction`: `RECONCILE` exige `reconciliationId`; `markReconciled` directo deja de existir como comando público. |
| application | Comandos `StartReconciliation`, `ToggleClearedInSession`, `CompleteReconciliation` (con `adjustment?: { reason }`), `CancelReconciliation`; `SetClearedStatus` (individual/lote) publica `TransactionCleared`; `UnreconcileTransaction` anota la sesión. Queries `GetReconciliation` (con saldo confirmado y diferencia en vivo), `ListReconciliations`, `GetReconciliationStatus(accountId, asOf)` (contrato público para PLANNING). Todas las mutaciones: UoW única con `SET LOCAL app.workspace_id`, auditoría, transición y outbox. |
| infrastructure | Repositorio Kysely `ReconciliationRepository`; migración `txn_reconciliation`; consultas de saldo confirmado (legs vigentes sobre la cuenta + saldo inicial por `LedgerQueryPort`). |
| interface | Controllers `reconciliations`; `getReconciliationStatus` bajo `accounts`; UI: pantalla "Reconciliar" por cuenta (cabecera con extracto, saldo confirmado y diferencia en vivo; lista de transacciones hasta la fecha del extracto con casilla de confirmación; botón Finalizar habilitado con diferencia 0; diálogo de ajuste con motivo). |

Puertos consumidos: `LedgerQueryPort` (saldo inicial `EQUITY:OPENING_BALANCE` de la cuenta y saldos as-of, `add-ledger-core`), `PeriodLockQuery` (lectura de `ledger.period_lock`, D10), `AccountDirectory` (estado/naturaleza/moneda), `LedgerPostingPort` (asiento del ajuste, mismo traductor de `ADJUSTMENT` de `add-transaction-recording`), `AuditPort` + `LifecyclePort` (`add-lifecycle-timeline`), `Clock` (hoy en la TZ del workspace).

## Objetivos / No objetivos

**Objetivos:**
- FR-TRANSACTIONS-030 completo y criterio de salida de Phase 2 (reconciliar todas las cuentas a diferencia 0 antes de cerrar un mes).
- Evento `transactions.TransactionCleared.v1` (D47) y `transactions.ReconciliationCompleted.v1`.
- Query pública de estado de reconciliación para `planning/month-closing`.

**No objetivos:**
- Matching automático con extractos importados (Phase 6), adjuntar el extracto (Phase 6: `statement_document_id` queda reservado y nulo).
- Reabrir una sesión completada (no hay transición; se des-reconcilia por transacción).
- Reglas del checklist de cierre (bloqueante o advertencia): las define `planning/month-closing` (pf-p2a).

## Decisiones

1. **Saldo confirmado** = saldo inicial de la cuenta (postings contra `EQUITY:OPENING_BALANCE:<CCY>` de la cuenta, que en Phase 1 no tienen fila en `txn`, docs/08 as-built) + Σ legs vigentes sobre la cuenta de transacciones `CLEARED|RECONCILED` con `business_date ≤ statement_date`. Las transacciones de fecha posterior al extracto quedan fuera aunque estén `cleared` (se reconciliarán en la sesión siguiente). Se calcula siempre en vivo; solo al completar se congela `cleared_balance` en la sesión. En pasivos se presenta `−saldo` (deuda positiva), coherente con el patrimonio neto.
2. **Sin "selección" separada del estado `cleared`.** La sesión no mantiene una lista de candidatos: el conjunto incluido es exactamente "`cleared` de la cuenta con fecha ≤ extracto" en el momento de finalizar. Confirmar/desconfirmar en la sesión es el mismo `CLEAR`/`UNCLEAR` de Phase 1 (registrado además como anotación de la sesión). Alternativa descartada: ítems seleccionados en `reconciliation_item` durante la sesión (duplica el estado `cleared` y abre divergencias). `reconciliation_item` registra solo lo **reconciliado** al completar (y luego la des-reconciliación posterior, `unreconciled_at`).
3. **Secuencia de sesiones.** `statement_date` estrictamente mayor que la de la última `COMPLETED` y ≤ hoy (TZ workspace); una `IN_PROGRESS` por cuenta (índice único parcial). Las canceladas no cuentan para la secuencia.
4. **Finalizar** (`CompleteReconciliation`, aislamiento `SERIALIZABLE` con hasta 3 reintentos, docs/08 §11): (a) verifica `If-Match`; (b) recalcula saldo confirmado; (c) diferencia ≠ 0 ⇒ `RECONCILIATION_DIFFERENCE_NOT_ZERO` (422, `difference` en el problem) salvo `adjustment.reason`; (d) chequea periodo cerrado de cada transacción incluida y de la fecha del ajuste ⇒ `PERIOD_CLOSED` (409, `errors[]` por transacción); (e) crea el ajuste (`kind=ADJUSTMENT`, `direction` = `INCREASE` si diferencia > 0 en activos, etc., monto `|diff|`, `business_date = statement_date`, `adjustment_reason`, `reconciliation_id` aditivo) con transiciones `RECORD → CLEARED` y luego `RECONCILE`; (f) `RECONCILE` de cada incluida con `reconciliationId`; (g) inserta `reconciliation_item`; (h) sesión `COMPLETED`, `cleared_balance`, `difference = 0`; (i) auditoría por transacción + una de la sesión (`RECONCILIATION_COMPLETED`), transiciones, outbox. Dirección del ajuste: en `ASSET` diferencia > 0 ⇒ `INCREASE`; en `LIABILITY` (expresada como deuda) diferencia > 0 ⇒ aumenta la deuda (`INCREASE` sobre el pasivo, docs/08 `adjustment_direction`).
5. **Marcado directo `reconciled` retirado** (MODIFIED): `PATCH …/transactions/{id}` con `status=RECONCILED` ⇒ 409 `RECONCILIATION_SESSION_REQUIRED`. Es un cambio de semántica del contrato v1 (docs/10 §11): se justifica porque `reconciled` pasa a significar "cotejado contra un extracto"; BFF y API se despliegan juntos y el único cliente es la web. Se registra en el changelog del contrato y en la pregunta abierta 2 por si el owner prefiere conservarlo.
6. **Periodos cerrados** (extensión de D49, pregunta abierta 1): `CLEAR`, `UNCLEAR`, `RECONCILE` y `UNRECONCILE` consultan `PeriodLockQuery` por el `year_month` de la `business_date` (bloqueo mensual, D10) y rechazan con `PERIOD_CLOSED`. El ajuste además lo rechazaría el trigger `PF004` del ledger (doble barrera). Mientras no exista `planning/financial-periods`, no hay filas en `ledger.period_lock` y el chequeo es inocuo.
7. **Eventos.** `CLEAR`/`UNCLEAR` publican `TransactionCleared.v1` **y** siguen publicando `TransactionUpdated.v1` (`changedFields=[status]`) — cambio aditivo, sin romper a REPORTING. `RECONCILE` sigue con `TransactionUpdated.v1`. Completar publica `ReconciliationCompleted.v1`. Iniciar y cancelar no publican evento (la máquina lo declara así; quedan en auditoría y recorrido).
8. **Des-reconciliar después de completar**: la sesión no cambia de estado; `reconciliation_item.unreconciled_at/by/reason` se completa y el recorrido de la sesión muestra la anotación. El "estado de reconciliación" de la cuenta deja de contarla como reconciliada.
9. **Estado por cuenta** (`GetReconciliationStatus(accountId, asOf)`): `{ lastCompleted: { reconciliationId, statementDate, statementBalance } | null, inProgress: reconciliationId | null, unreconciledCount, unreconciledCleared, unreconciledPosted }` con `business_date ≤ asOf`. Contrato TS en `@pf/transactions/contracts` para PLANNING (síncrono, query), sin FK cross-schema.
10. **Idempotencia y concurrencia.** `Idempotency-Key` obligatorio en `startReconciliation`, `completeReconciliation` y `cancelReconciliation`; `If-Match` (versión de la sesión) en toggle/complete/cancel; toggle además exige la versión de la transacción (como mark-cleared).
11. **Roles.** VIEWER: leer sesiones, estado y recorrido; EDITOR/OWNER: iniciar, confirmar, finalizar (incluido el ajuste), cancelar, des-reconciliar (docs/10 §14: crear/editar transacciones).
12. **Rendimiento.** Saldo confirmado con una consulta agregada sobre `txn.transaction_leg` vigentes de la cuenta (índice existente `(workspace_id, account_id, transaction_date DESC, …) WHERE superseded_in_revision IS NULL`) filtrada por estado; objetivo p95 ≤ 150 ms (NFR-PERF-003) con 50k transacciones; finalizar con ≤ 2 000 transacciones incluidas ≤ 2 s.

### Contratos (OpenAPI, `contracts/openapi/finance-api.v1.yaml`)

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `listReconciliations` | `GET W/reconciliations?accountId=&status=` | VIEWER | Cursor; orden `statementDate DESC` |
| `startReconciliation` | `POST W/reconciliations` | EDITOR | `{ accountId, statementDate, statementBalance: DecimalString }`; `Idempotency-Key`; 201 + `ETag`; 409 `RECONCILIATION_IN_PROGRESS`, `ACCOUNT_ARCHIVED`, `ACCOUNT_CLOSED`; 422 `RECONCILIATION_STATEMENT_DATE_INVALID`, `AMOUNT_SCALE_EXCEEDED` |
| `getReconciliation` | `GET W/reconciliations/{id}` | VIEWER | `Reconciliation` con `clearedBalance`, `difference` en vivo (o congelados si `COMPLETED`), `items[]` si completada |
| `toggleReconciliationCleared` | `POST W/reconciliations/{id}/cleared` | EDITOR | `{ items: [{ id, version }], cleared: boolean }` (≤ 500, todo o nada); `If-Match` de la sesión; reutiliza las reglas de `markTransactionsCleared` |
| `completeReconciliation` | `POST W/reconciliations/{id}/complete` | EDITOR | `{ adjustment?: { reason } }`; `If-Match`; `Idempotency-Key`; 422 `RECONCILIATION_DIFFERENCE_NOT_ZERO` (extensión `difference`), 409 `PERIOD_CLOSED`, `INVALID_STATUS_TRANSITION` |
| `cancelReconciliation` | `POST W/reconciliations/{id}/cancel` | EDITOR | `If-Match`; `Idempotency-Key` |
| `getReconciliationStatus` | `GET W/accounts/{id}/reconciliation-status?asOf=` | VIEWER | `ReconciliationStatus` |
| `getReconciliationLifecycle` | `GET W/reconciliations/{id}/lifecycle` | VIEWER | Mismo schema `Lifecycle`; `lifecycle-machines/Reconciliation`; export CSV/PDF del recorrido como el resto (D52) |
| `updateTransaction` | `PATCH W/transactions/{id}` | EDITOR | `status=RECONCILED` ⇒ 409 `RECONCILIATION_SESSION_REQUIRED` |

Códigos nuevos en `ErrorCode` + `ErrorCatalog` + `apps/web/messages/errors.{es,en,pt}.json`: `RECONCILIATION_IN_PROGRESS` (409), `RECONCILIATION_STATEMENT_DATE_INVALID` (422), `RECONCILIATION_DIFFERENCE_NOT_ZERO` (422), `RECONCILIATION_SESSION_REQUIRED` (409). `PERIOD_CLOSED` (409) ya existe.

### Modelo de datos (schema `txn`)

| Tabla | Definición | RLS / grants |
|---|---|---|
| `txn.reconciliation` | `id uuid PK`, `workspace_id`, `account_id`, `currency` (FK `fx.currency`), `statement_date date`, `statement_balance numeric(38,18)`, `cleared_balance numeric(38,18) NULL`, `difference numeric(38,18) NULL`, `status text CHECK IN ('IN_PROGRESS','COMPLETED','CANCELLED')`, `adjustment_transaction_id uuid NULL` (FK compuesta a `txn.transaction`), `statement_document_id uuid NULL` (reservado Phase 6, sin FK), `started_by`, `started_at`, `completed_by/at NULL`, `cancelled_by/at NULL`, `version int`. CHECKs: `status='COMPLETED' ⇔ completed_at IS NOT NULL AND cleared_balance IS NOT NULL AND difference = 0`; `status='CANCELLED' ⇔ cancelled_at IS NOT NULL`. Único parcial `(workspace_id, account_id) WHERE status='IN_PROGRESS'`; índice `(workspace_id, account_id, statement_date DESC)` | WS forzada; `pf_app` SELECT/INSERT/UPDATE (sin DELETE) |
| `txn.reconciliation_item` | PK `(workspace_id, reconciliation_id, transaction_id)`, `reconciled_at`, `unreconciled_at/by NULL`, `unreconcile_reason NULL`; índice `(workspace_id, transaction_id)` | WS forzada; `pf_app` SELECT/INSERT/UPDATE (solo columnas `unreconciled_*` por grant de columna) |
| `txn.transaction` | Columna aditiva `reconciliation_id uuid NULL` (solo en el ajuste creado por una sesión) | sin cambios |

Las dos tablas se registran en `platform.workspace_scoped_table` (purga demo, ADR-0026) y se exportan/importan en `add-workspace-export`.

### Eventos

| Evento | Cuándo | Payload | Idempotencia |
|---|---|---|---|
| `transactions.TransactionCleared.v1` (nuevo) | `CLEAR`/`UNCLEAR` (individual, lote, sesión, bulk edit) | `transactionId`, `accountId`, `cleared: boolean`, `status`, `previousStatus`, `revision`, `reconciliationId|null`, `bulkOperationId|null`, `transition` | natural `(transactionId, aggregateVersion)` |
| `transactions.ReconciliationCompleted.v1` (nuevo) | `COMPLETE` | `reconciliationId`, `accountId`, `currency`, `statementDate`, `statementBalance`, `clearedBalance`, `transactionIds[]` (≤ 2 000; si excede, `transactionCount` y sin lista), `adjustmentTransactionId|null`, `transition` | natural `reconciliationId` |
| `transactions.TransactionUpdated.v1` | Sin cambio de schema | — | — |

Consumidores: ninguno obligatorio en este change; PLANNING (`month-closing`) puede consumir `ReconciliationCompleted` para refrescar el checklist (opcional: consulta síncrona por puerto). Schemas JSON en `contracts/events/transactions/`; docs/11 actualizado.

## Riesgos / Trade-offs

- **Cambio de semántica del marcado directo** (decisión 5): rompe un flujo de Phase 1 (`PATCH status=RECONCILED`); mitigado porque la única UI que lo usa se reemplaza por la sesión en el mismo release. Alternativa: mantenerlo como "reconciliación sin extracto" (pregunta 2).
- **Periodo cerrado y extractos que cruzan meses** (decisión 6): si el owner cierra marzo antes de reconciliar un extracto 05/03–04/04, tendrá que reabrir marzo. Es coherente con INV-015/D49 pero puede incomodar (pregunta 1).
- **Saldo inicial sin fila en `txn`**: el cálculo depende del ledger para el saldo inicial; si un change futuro lo modela como transacción `OPENING_BALANCE`, el calculador debe evitar contarlo dos veces (test de regresión TC-TRANSACTIONS-RECONCILIATION-003).
- **Contención en `SERIALIZABLE`** al finalizar con ediciones concurrentes: reintento acotado; aceptable con un usuario.
- **Volumen del evento `ReconciliationCompleted`** con muchas transacciones: lista acotada a 2 000.

## Plan de migración

1. Expand: `20261006xxxxxx_txn_reconciliation.sql` crea `txn.reconciliation`, `txn.reconciliation_item`, columna `txn.transaction.reconciliation_id`, RLS forzada, grants, índices y registro en `platform.workspace_scoped_table`. No destructiva; compatible N-1 (la versión anterior ignora las tablas).
2. Datos existentes: las transacciones `RECONCILED` de Phase 1 (marcadas sin sesión) **se conservan** como están; no se crea una sesión retroactiva. El estado por cuenta las cuenta como reconciliadas sin `lastCompleted` (la UI muestra "reconciliada sin extracto"). La primera sesión de cada cuenta solo exige fecha ≤ hoy.
3. Contrato: nuevas operaciones y códigos (MINOR); el cambio de semántica de `updateTransaction` se documenta en el changelog del contrato.
4. Rollback: desplegar la versión anterior deja las tablas sin uso (no hay contract de columnas).

## Preguntas abiertas

1. **Transiciones sin ledger en periodos cerrados.** ¿`CLEAR`/`UNCLEAR`/`RECONCILE`/`UNRECONCILE` de transacciones con fecha en un periodo cerrado se rechazan con `PERIOD_CLOSED` (extensión de D49)? **Recomendación:** sí, rechazar (INV-015: el snapshot de cierre registra el estado de reconciliación y no debe cambiar en silencio); el checklist de cierre de pf-p2a debe advertir "cuentas sin reconciliar" antes de cerrar para evitar reaperturas.
2. **Marcado directo `reconciled` sin sesión.** ¿Se retira (`RECONCILIATION_SESSION_REQUIRED`) o se conserva como "reconciliación sin extracto"? **Recomendación:** retirarlo; `reconciled` debe significar "cotejado contra un extracto" para que el criterio de salida y el checklist sean verificables.
3. **Ajuste categorizado.** ¿El ajuste de una sesión puede ir contra una categoría de gasto/ingreso (p. ej. "Comisiones") en lugar de `EQUITY:ADJUSTMENTS`? **Recomendación:** no en Phase 2 (FR-TRANSACTIONS-017 manda `EQUITY:ADJUSTMENTS`); si la diferencia es una comisión conocida, el usuario registra el gasto y vuelve a finalizar con diferencia 0.
4. **Reconciliar cuentas `CLOSED`.** ¿Se permite una sesión (solo con diferencia 0, sin ajuste) sobre una cuenta cerrada para cuadrar su último extracto? **Recomendación:** no en Phase 2; se reconcilia antes de cerrar la cuenta.
5. **Transacciones `RECONCILED` de Phase 1 sin sesión.** ¿Se dejan como "reconciliadas sin extracto" (plan de migración 2) o se devuelven a `cleared` con una migración auditada? **Recomendación:** dejarlas (no reescribir historia); la próxima sesión de la cuenta las incluye en el saldo confirmado.

## Dependencias entre changes

- **Requiere aplicados:** `add-transaction-recording`, `add-ledger-core`, `add-accounts-management`, `add-audit-trail`, `add-lifecycle-timeline`, `add-event-outbox` (Phase 1, archivados) y `add-classification` (activo; categoría de sistema `ADJUSTMENTS` no se usa porque el ajuste va a `EQUITY:ADJUSTMENTS`).
- **Coordina con `planning/financial-periods` y `planning/month-closing` (pf-p2a):** este change lee `ledger.period_lock` (existente) para `PERIOD_CLOSED` y expone `GetReconciliationStatus` para el ítem "cuentas sin reconciliar" del checklist (FR-PLANNING-003). Puede implementarse antes que el cierre (sin locks el chequeo es inocuo); el cierre debe implementarse después o en paralelo consumiendo el puerto.
- **Lo consumen:** `add-bulk-edit` (estado `cleared` en lote publica `TransactionCleared.v1`), `add-workspace-export` (exporta e importa `txn.reconciliation*`), `add-global-audit-view` (acciones `RECONCILIATION_*` filtrables).
- **Notificaciones (pf-p2b, `notifications/alerts`):** sin dependencia; podría notificar "cuenta sin reconciliar hace > 30 días" en una fase posterior (docs/14 `AttentionInbox`).
