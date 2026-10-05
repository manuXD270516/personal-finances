# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Este change implementa el núcleo del contexto **TRANSACTIONS** (`@pf/transactions`, schema PG `txn`) según ARCHITECTURE §3–§4 y §7, docs/04 §3.4 y §4.1, docs/05 §2.4, docs/08 §5.4, docs/09 §5–§11 y docs/10. Las fuentes canónicas de reglas financieras son el catálogo INV-NNN de docs/09 §16 y FR-TRANSACTIONS-001..031 de docs/01.

Capas afectadas:

| Capa | Cambios |
|---|---|
| domain | Agregado `Transaction` (kind, status, businessDate, postingDate, legs, splits, revision, version, refundOfTransactionId, adjustmentReason, origin, externalRef); VO `TransactionStatus` con la máquina de estados de docs/04 §4.1; VO `TransactionLeg`, entidad `TransactionSplit`; servicios de dominio `TransactionPostingTranslator` (Transaction → `JournalEntryDraft`, mapeo docs/09 §6.1, §6.2, §6.3, §6.5, §6.6), `SplitAllocator` (largest remainder vía `Money.allocate` del shared-kernel), `DuplicateDetector` (puro, sin persistencia en Phase 1); errores de dominio con los códigos del catálogo. |
| application | Comandos `RecordTransaction` (income/expense), `RecordRefund`, `RecordAdjustment`, `PostTransaction`, `AmendTransaction`, `ApplyClassification`, `VoidTransaction`, `SetClearedStatus` (individual y lote), `MarkReconciled`, `UnreconcileTransaction`; queries `GetTransaction`, `ListTransactions`, `CheckDuplicates`. Unit of Work único por comando: `SET LOCAL app.workspace_id`, agregado + `LedgerPostingPort` + `AuditPort` + outbox en la misma transacción. |
| infrastructure | Repositorio Kysely `TransactionRepository` (lectura/escritura de `txn.*`), adapter de outbox, migraciones SQL (dbmate). |
| interface | Controllers Nest bajo `/api/v1/workspaces/{workspaceId}/transactions`, mapeo DTO ↔ dominio (montos como string), `ETag`/`If-Match`, `Idempotency-Key` (middleware de `add-api-conventions`). UI Next.js: formulario de transacción (con splits y advertencia de duplicados), registro por cuenta, detalle con historial. |

Puertos consumidos (todos vía `contracts` del otro contexto, ARCHITECTURE §6–§7):

- `LedgerPostingPort` (LEDGER, **síncrono, misma transacción BD**): `postEntry(draft)` → `journalEntryId`; `reverseEntry(entryId, reverseDate)` → `reversalEntryId`. Ledger valida cuadre por moneda (INV-004), postings ≠ 0 (INV-005), moneda de cuenta (INV-006), get-or-create de `ASSET:<accountId>`, `LIABILITY:<accountId>`, `INCOME:<CCY>`, `EXPENSE:<CCY>`, `EQUITY:ADJUSTMENTS:<CCY>` y emite `ledger.JournalEntryPosted.v1`.
- `AccountDirectory` (ACCOUNTS, query): moneda, naturaleza (`ASSET|LIABILITY`) y estado (`active|closed|archived`) de las cuentas.
- `ClassificationValidator` (CLASSIFICATION, query): categoría existente/activa/tipo, categoría de sistema *Uncategorized*, tags y contrapartes activas.
- `AuditPort` (AUDIT, síncrono, misma transacción): `append(AuditLog)` con diff antes/después.
- `Clock`, `IdGenerator` (UUIDv7) del shared-kernel.

## Objetivos / No objetivos

**Objetivos:**
- Ingresos, gastos, reembolsos y ajustes con splits, estados, posteo atómico, edición con reversa, anulación, reconciliación simple y advertencia de duplicados (Phase 1).
- Garantizar INV-021, INV-023, INV-024, INV-026 y INV-033 en dominio y, donde es posible, en BD.
- Dejar el agregado `Transaction` listo para que `add-transfers` y `add-manual-conversions` agreguen sus kinds sin cambiar la máquina de estados ni el traductor base.

**No objetivos:**
- Transferencias, conversiones, saldos iniciales, préstamos (otros changes).
- Sesiones de reconciliación (`txn.reconciliation`, `txn.reconciliation_item`), `txn.duplicate_candidate` persistente, bulk edit, custom fields, `PERIOD_CLOSED` (Phase 2+).
- Saldo proyectado y saldos as-of: los expone `ledger/balances` (`add-ledger-core`); este change solo provee las transacciones `pending` como insumo de la proyección.

## Decisiones

1. **Fecha contable = fecha de negocio.** `JournalEntry.entryDate = transaction.businessDate`; `postingDate` (fecha valor bancaria) es informativa, se persiste y se usará en la reconciliación de Phase 2. Resuelve la pregunta abierta 1 de docs/01 con su propuesta. Alternativa (usar `postingDate`) descartada: movería gastos entre meses según el banco y rompería el cierre mensual.
2. **Monto y dirección.** Los comandos reciben magnitudes positivas (`PositiveMoney`); la dirección la da `kind` (y `direction: INCREASE|DECREASE` en `ADJUSTMENT`). Legs con signo contable desde la cuenta (docs/09 §3). Rechazos: `AMOUNT_NOT_POSITIVE`, `AMOUNT_SCALE_EXCEEDED` (validado en dominio contra `currency.scale`, nunca se redondea la entrada), `CURRENCY_MISMATCH`.
3. **Traducción a postings** (`TransactionPostingTranslator`, puro y con PBT de INV-004/INV-024):
   - `INCOME`: +cuenta, −`INCOME:<CCY>` por split. `EXPENSE`: +`EXPENSE:<CCY>` por split, −cuenta. `REFUND`: +cuenta, −`EXPENSE:<CCY>` por split (misma categoría del gasto). `ADJUSTMENT`: ±cuenta, ∓`EQUITY:ADJUSTMENTS:<CCY>`, sin splits en Phase 1.
   - Cada posting nominal lleva `splitId` (FR-LEDGER-008).
4. **Máquina de estados** (docs/04 §4.1, FR-TRANSACTIONS-006): `pending→posted` (crea asiento), `posted↔cleared` (sin ledger), `cleared→reconciled` (sin ledger, Phase 1 simple), `reconciled→cleared` solo vía `UnreconcileTransaction` con motivo, `pending|posted|cleared→void`. `reconciled→void` y la edición financiera de `reconciled` se rechazan con `TRANSACTION_RECONCILED` (requieren des-reconciliar primero). Editar montos de un `cleared` lo devuelve a `posted` (docs/09 §11). Transición inválida ⇒ `INVALID_STATUS_TRANSITION` (409).
5. **Edición (`AmendTransaction`).** Si cambian monto, fecha, cuenta o montos de splits: `reverseEntry(activo)` con fecha = fecha del asiento original (Phase 1 no tiene periodos cerrados) + `postEntry(revision+1)`; legs/splits anteriores quedan con `superseded_in_revision` (los postings históricos los siguen referenciando); `active_entry_id` apunta al nuevo asiento; `transaction_journal_link` conserva la cadena. Si solo cambian descripción/notas/contraparte/tags/categorías: actualización in situ + `version+1`, sin ledger (INV-033). Un PATCH que mezcle `status` con campos financieros se rechaza con `VALIDATION_FAILED` (operaciones separadas, auditoría clara).
6. **Optimistic locking.** `version` en `txn.transaction`; `If-Match` obligatorio en PATCH/void/post/unreconcile/mark-cleared (por ítem); ausencia ⇒ `428 PRECONDITION_REQUIRED`, desajuste ⇒ `412 PRECONDITION_FAILED`; carrera detectada en el `UPDATE … WHERE version = :v` ⇒ `409 CONCURRENCY_CONFLICT`.
7. **Idempotencia.** `Idempotency-Key` obligatorio en `createTransaction`, `voidTransaction`, `postTransaction`, `markTransactionsCleared` (mecanismo de `platform.idempotency_key` de `add-api-conventions`, docs/10 §7). La respuesta almacenada se guarda en la misma transacción BD que el comando.
8. **Reembolsos.** `refundOfTransactionId` opcional; si se informa, debe ser un `EXPENSE` del mismo workspace y misma moneda. Σ reembolsos no anulados vinculados + nuevo > monto vigente del original ⇒ `REFUND_EXCEEDS_ORIGINAL` (422) salvo `confirmRefundExceedsOriginal: true` (se audita la confirmación). La validación toma `SELECT … FOR UPDATE` sobre el original para evitar carreras entre dos reembolsos.
9. **Ajustes.** `reason` obligatorio (1–500 caracteres) y `direction`; se persisten en `adjustment_reason` y quedan marcados como `kind=ADJUSTMENT` en listados y reportes (FR-TRANSACTIONS-017). Ajustes categorizados (contra EXPENSE/INCOME) quedan fuera de Phase 1: el usuario registra un gasto/ingreso normal.
10. **Cuentas no activas (INV-026).** Antes de postear o revertir, el comando consulta `AccountDirectory` para todas las cuentas de los legs; `archived` ⇒ `ACCOUNT_ARCHIVED` (409), `closed` ⇒ `ACCOUNT_CLOSED` (409). Registrar `pending` sobre una cuenta no activa también se rechaza (evita pendientes imposibles de postear).
11. **Splits.** Sin `splits` ⇒ un split por el total con la categoría de sistema *Uncategorized*; `splits: []` ⇒ `VALIDATION_FAILED`. Σ splits ≠ monto ⇒ `SPLITS_DO_NOT_SUM` (422). Reparto por porcentaje/partes iguales lo calcula la UI llamando a la misma regla del shared-kernel (`Money.allocate`, largest remainder, desempate por índice menor) y la API solo valida la suma: el servidor nunca reparte en silencio.
12. **Reconciliación simple.** `SetClearedStatus` en lote (≤ 500 ítems) es all-or-nothing en una transacción BD; un `bulkOperationId` común se guarda en cada `AuditLog`. `MarkReconciled` usa `PATCH status=RECONCILED`; `UnreconcileTransaction` es una acción explícita con motivo. Sin tablas de reconciliación en Phase 1.
13. **Duplicados (solo advertencia).** `DuplicateDetector` busca transacciones no anuladas de la misma cuenta, mismo monto y moneda, `|businessDate − fecha| ≤ 3 días` y descripción normalizada (minúsculas, sin acentos, sin espacios repetidos) igual o con prefijo común ≥ 5 caracteres, o misma contraparte. Se expone en `checkTransactionDuplicates` (sin efectos) y como `warnings[]` en la respuesta 201 de `createTransaction` cuando `source = MANUAL`. Nada se persiste ni se marca. Umbral de similitud ajustable sin cambiar la spec.
14. **Búsqueda de texto (Should).** Columna generada `search_text` = `unaccent(lower(description || ' ' || notes))` con índice GIN `pg_trgm`; la contraparte se resuelve por IDs de Classification (búsqueda de nombre → IDs → filtro). Requiere extensiones `unaccent` y `pg_trgm` (wrapper `IMMUTABLE` para `unaccent`).
15. **Historial.** No hay endpoint propio: la UI usa `GET W/audit-log?aggregateType=Transaction&aggregateId={id}` de `audit/audit-trail` (`add-audit-trail`). Los comandos de este change escriben acciones `TRANSACTION_CREATED|UPDATED|POSTED|CLEARED|UNCLEARED|RECONCILED|UNRECONCILED|VOIDED` con diff.
16. **Duplicar (Could).** Solo UI: precarga el formulario con los datos de la original y crea una transacción nueva por `createTransaction` (nueva `Idempotency-Key`); sin vínculo contable.

### Modelo de datos (schema `txn`, docs/08 §5.4)

| Tabla | Cambios en este change | RLS / grants |
|---|---|---|
| `txn.transaction` | Crear con columnas de docs/08 + `posting_date date NULL`, `refund_of_transaction_id uuid NULL` (FK intra-schema a `txn.transaction`), `adjustment_reason text NULL`, `confirmed_refund_excess boolean NOT NULL DEFAULT false`, `search_text` (generada). CHECKs: `kind IN (…)`, `status IN ('PENDING','POSTED','CLEARED','RECONCILED','VOIDED')`, `status IN ('PENDING','VOIDED') ⇔ active_entry_id IS NULL` (INV-023), `status='VOIDED' ⇔ voided_at IS NOT NULL`, `kind='ADJUSTMENT' ⇒ adjustment_reason IS NOT NULL`, `refund_of_transaction_id IS NULL OR kind='REFUND'`. | WS (`workspace_id = current_setting('app.workspace_id')::uuid`); `pf_app`: SELECT/INSERT/UPDATE, sin DELETE |
| `txn.transaction_leg` | Crear (docs/08) + `superseded_in_revision int NULL`. CHECK `amount <> 0`. Índice `(workspace_id, account_id, transaction_date DESC, transaction_id DESC)` (registro y duplicados). | WS; sin DELETE |
| `txn.transaction_split` | Crear (docs/08). CHECK `amount <> 0`. **Constraint trigger diferido** `txn.assert_splits_sum()`: Σ splits vigentes = monto nominal de la transacción para `INCOME|EXPENSE|REFUND` (INV-021). | WS; sin DELETE |
| `txn.split_tag` | Crear (docs/08). | WS |
| `txn.transaction_journal_link` | Crear (docs/08), append-only. | WS-RO: solo SELECT/INSERT |

Todas con `workspace_id NOT NULL`, FK compuesta `(transaction_id, workspace_id)` intra-schema, sin FKs cross-schema salvo `workspace_id → iam.workspace` y `currency → fx.currency` (NFR-DATA-015). Las tablas de Phase 2/6 (`reconciliation`, `reconciliation_item`, `duplicate_candidate`, `conversion_*`, `split_custom_field_value`) **no** se crean aquí (`conversion_*` las crea `add-manual-conversions`).

### Eventos

| Evento | Cuándo | Idempotencia del consumidor |
|---|---|---|
| `transactions.TransactionCreated.v1` | Toda transacción aceptada (pending, posted o cleared) | `eventId` + natural `transactionId` |
| `transactions.TransactionPosted.v1` | Creación en posted/cleared, `pending→posted`, amend que repostea (`supersedesJournalEntryId`) | natural `(transactionId, revision)` |
| `transactions.TransactionVoided.v1` | Anulación (con `reversalJournalEntryId` o null si era pending) | natural `transactionId` |
| `transactions.TransactionCategorized.v1` | Cambio de categoría/tags de ≥ 1 split (`appliedBy=USER`) | natural `(transactionId, aggregateVersion)` |
| `transactions.TransactionUpdated.v1` (nuevo schema) | Edición descriptiva, cambios `cleared`/`reconciled`/des-reconciliación y amend financiero (junto a `TransactionPosted`), con `changedFields[]` y `ledgerImpact` | natural `(transactionId, aggregateVersion)` |
| `ledger.JournalEntryPosted.v1` (producido por LEDGER) | Cada asiento y reversa | natural `journalEntryId` |

Todos se insertan en `platform.outbox` en la misma transacción que el cambio (ADR-0008); orden garantizado por agregado (`aggregateVersion`). Consumidores Phase 1: REPORTING (`add-basic-dashboard`).

## Contratos

Cambios **exactos** requeridos (no se editan aquí; los consolida el proceso de contratos):

**`contracts/openapi/finance-api.v1.yaml`**

1. `components.schemas.ErrorCode`: agregar `REFUND_EXCEEDS_ORIGINAL` (422) y `ACCOUNT_CLOSED` (409). Documentar en docs/10 §9.1.
2. `components.schemas.TransactionCreate`: agregar `postingDate` (`LocalDate`, opcional), `refundOfTransactionId` (`Uuid`, solo `REFUND`), `confirmRefundExceedsOriginal` (boolean, default false, solo `REFUND`), `reason` (string 1–500, **obligatorio** si `kind=ADJUSTMENT`), `externalRef` (`ExternalRef`, opcional). Documentar que `direction` es obligatorio para `ADJUSTMENT` y que `splits` no aplica a `ADJUSTMENT` en Phase 1.
3. `components.schemas.Transaction`: agregar `postingDate` (`LocalDate|null`), `refundOfTransactionId` (`uuid|null`), `adjustmentReason` (`string|null`), `adjustmentDirection` (`INCREASE|DECREASE|null`), `activeJournalEntryId` (`uuid|null`).
4. Nuevo `components.schemas.TransactionWarning`: `{ code: enum [POSSIBLE_DUPLICATE], transactionIds: Uuid[] (minItems 1), detail: string }`. Nuevo `TransactionCreateResult` = `allOf[Transaction]` + `warnings: TransactionWarning[]`; usarlo como schema de la respuesta 201 de `createTransaction`.
5. `components.schemas.TransactionUpdate`: agregar `postingDate` (`LocalDate|null`); `status` pasa a `enum [POSTED, CLEARED, RECONCILED]` con descripción: POSTED↔CLEARED, CLEARED→RECONCILED; RECONCILED→CLEARED solo vía `unreconcileTransaction`; no combinable con campos financieros (`VALIDATION_FAILED`).
6. `createTransaction`: descripción ampliada (refund/adjustment/warnings); errores documentados: 409 `ACCOUNT_ARCHIVED|ACCOUNT_CLOSED|CATEGORY_ARCHIVED`, 422 `CURRENCY_MISMATCH|SPLITS_DO_NOT_SUM|AMOUNT_SCALE_EXCEEDED|AMOUNT_NOT_POSITIVE|REFUND_EXCEEDS_ORIGINAL|CATEGORY_KIND_MISMATCH|REFERENCE_NOT_FOUND`.
7. `updateTransaction`: errores 409 `TRANSACTION_RECONCILED|INVALID_STATUS_TRANSITION|ACCOUNT_ARCHIVED|ACCOUNT_CLOSED|CONCURRENCY_CONFLICT`; agregar `x-openspec-capability: transactions/reconciliation` a la lista.
8. `voidTransaction`: documentar 409 `INVALID_STATUS_TRANSITION|TRANSACTION_RECONCILED|ACCOUNT_ARCHIVED|ACCOUNT_CLOSED`; agregar `'422': UnprocessableEntity` (motivo vacío).
9. `postTransaction`: documentar 409 `INVALID_STATUS_TRANSITION|ACCOUNT_ARCHIVED|ACCOUNT_CLOSED`.
10. `listTransactions`: agregar parámetro `source` (array de `TransactionSource`); documentar que `categoryId` incluye subcategorías y que `q` busca en descripción, notas y nombre de contraparte sin acentos ni mayúsculas.
11. Nueva operación `POST /workspaces/{workspaceId}/transactions/mark-cleared` — `operationId: markTransactionsCleared`, `x-openspec-capability: transactions/reconciliation`, `x-required-role: EDITOR`, `Idempotency-Key` obligatorio; body `ClearedMarkRequest { items: [{ id: Uuid, version: Version }] (1–500, uniqueItems), cleared: boolean }`; 200 `{ data: Transaction[], bulkOperationId: Uuid }`; 400, 401, 403, 404, 409 (`INVALID_STATUS_TRANSITION`, `TRANSACTION_RECONCILED`), 412 (`PRECONDITION_FAILED` por ítem en `errors[]`), 428.
12. Nueva operación `POST /workspaces/{workspaceId}/transactions/{transactionId}/unreconcile` — `operationId: unreconcileTransaction`, capability `transactions/reconciliation`, rol EDITOR, `If-Match` obligatorio; body `UnreconcileRequest { reason: string 1–500 }`; 200 `Transaction` + `ETag`; 400, 401, 403, 404, 409 (`INVALID_STATUS_TRANSITION`), 412, 422, 428.
13. Nueva operación `POST /workspaces/{workspaceId}/transactions/duplicate-check` — `operationId: checkTransactionDuplicates`, capability `transactions/duplicate-detection`, rol EDITOR, sin efectos (no requiere `Idempotency-Key`); body `DuplicateCheckRequest { accountId, amount: PositiveMoney, transactionDate, description?, counterpartyId?, excludeTransactionId? }`; 200 `{ candidates: [{ transactionId, transactionDate, amount: Money, description, counterpartyId, status }] }`; 400, 401, 403, 422.
14. Historial: sin operación nueva; requiere que `GET W/audit-log` (de `add-audit-trail`) admita `aggregateType=Transaction&aggregateId=` con rol VIEWER.

**`contracts/events/`**

1. `transactions/TransactionCreated.v1.schema.json` (aditivo, misma versión): `payload.status` enum `[PENDING, POSTED, CLEARED]`; agregar `postingDate` (`LocalDate|null`) y `refundOfTransactionId` (`Uuid|null`) como requeridos con `null` permitido; actualizar ejemplo.
2. Nuevo `transactions/TransactionUpdated.v1.schema.json`: envelope + `aggregateType: Transaction`; payload `{ transactionId, revision, status (PENDING|POSTED|CLEARED|RECONCILED), previousStatus (…|null), changedFields: string[] (minItems 1; valores: description, notes, counterpartyId, postingDate, status, amount, businessDate, accountId, splits), ledgerImpact: boolean, reason: string|null }`; sin montos ni texto libre salvo `reason` (PII baja). Idempotencia natural `(transactionId, aggregateVersion)`.
3. Sin cambios en `TransactionPosted.v1`, `TransactionVoided.v1`, `TransactionCategorized.v1`.

> Consolidado en contracts/ el 2026-10-02.

## Dependencias con otros changes de Phase 1

- **Requiere (aplicar antes):** `bootstrap-platform-foundation`; `add-workspace-identity` (auth, RBAC EDITOR/VIEWER, contexto RLS); `add-api-conventions` (Idempotency-Key, problem+json, ETag/If-Match, cursor); `add-audit-trail` (`AuditPort`, consulta de audit-log); `add-accounts-management` (`AccountDirectory` con estado `closed`/`archived` y código `ACCOUNT_CLOSED`); `add-ledger-core` (`LedgerPostingPort.postEntry/reverseEntry`, cuentas de sistema, `JournalEntryPosted`); `add-classification` (`ClassificationValidator`, categorías de sistema *Uncategorized* y *Fees*).
- **Habilita:** `add-transfers` (kind `TRANSFER` sobre este agregado), `add-manual-conversions` (kind `CONVERSION`), `add-basic-dashboard` (consume los eventos).
- Saldos de apertura: `add-accounts-management` los orquesta en `apps/api` invocando el comando `RecordOpeningBalance`; ese comando y el kind `OPENING_BALANCE` los define ese change (este change no lo expone por API).

## Riesgos / Trade-offs

- [Traductor de postings con errores sutiles de signo] → TDD + PBT: ∀ transacción generada, asiento balanceado por moneda (INV-004) y legs = postings de cuentas de usuario (INV-024).
- [Constraint trigger de Σ splits añade costo al COMMIT] → solo para kinds nominales; medido contra NFR-PERF-003 (p95 ≤ 150 ms).
- [Validación de cuenta activa vía query cross-context puede quedar obsoleta en la misma transacción] → Accounts y Transactions comparten la transacción BD; se lee el estado con `FOR SHARE` sobre `accounts.account` a través del puerto.
- [Heurística de duplicados con falsos positivos] → solo advierte; nunca bloquea ni modifica.
- [Reembolsos concurrentes sobre el mismo original] → `FOR UPDATE` del original durante la validación.
- [Marcar `reconciled` sin sesión puede ocultar diferencias con el extracto] → aceptado en Phase 1; las sesiones (FR-TRANSACTIONS-030) llegan en Phase 2.

## Plan de migración

Expand-only y no destructiva: migración `txn_0001_transactions_core` crea el schema `txn`, tablas, CHECKs, constraint trigger diferido de splits, índices (incluido GIN trigram), extensiones `unaccent`/`pg_trgm` (si no existen), grants a `pf_app` y políticas RLS. Rollback en Phase 1 = revertir el commit y dropear el schema `txn` en entornos sin datos reales (no hay producción todavía). Seeds: el perfil `minimal` agrega las transacciones de docs/29 (un gasto con split, un pending, un refund, uno voided).

## Preguntas abiertas

1. ~~FR-TRANSACTIONS-005 admite un "adjustment informativo" con monto cero, incompatible con INV-005 (posting ≠ 0) y con `PositiveMoney`~~ — resuelta (docs/31 D17): ajuste de monto cero no permitido (`AMOUNT_NOT_POSITIVE`).
2. ~~¿`reconciled → void` debe permitirse directo o exigir des-reconciliar?~~ — resuelta (docs/31 D16): exige des-reconciliar antes (`TRANSACTION_RECONCILED`).
3. ~~Sobre-reembolso: advertencia no bloqueante (docs/04 §3.4) o confirmación explícita (FR-TRANSACTIONS-016)?~~ — resuelta por el owner el 2026-10-05 (docs/31 D47): se permite **con confirmación explícita** (`confirmRefundExceedsOriginal`, auditado como `confirmedRefundExcess`), comportamiento vigente.
4. ~~¿Evento propio `transactions.TransactionCleared` o `TransactionUpdated` con `changedFields=[status]`?~~ — resuelta por el owner el 2026-10-05 (docs/31 D47): en Phase 1 se mantiene `TransactionUpdated` con `changedFields=[status]`; el evento dedicado `transactions.TransactionCleared` se planifica para Phase 2 junto con la reconciliación (docs/24).

## Contratos adicionales (decisiones del owner D27/D28, 2026-10-02)

- `PaymentMethod` enum: `CASH | QR | DEBIT_CARD | CREDIT_CARD | BANK_TRANSFER | DIGITAL_WALLET | OTHER`; campo opcional `paymentMethod` (nullable) en `TransactionCreate`, `TransactionUpdate`, `Transaction`, `TransferCreate`, `Transfer`; filtro `paymentMethod` en `listTransactions`. Columna `txn.transaction.payment_method text NULL CHECK (payment_method IN (...))` (migración aditiva, expand). Sin impacto en ledger ni en eventos financieros; se agrega como campo aditivo en `transactions.TransactionCreated.v1` / `TransactionUpdated.v1`.
- Historial por transacción: `GET /workspaces/{workspaceId}/transactions/{transactionId}/history` (`getTransactionHistory`), rol mínimo **VIEWER**, devuelve solo entradas de auditoría de esa transacción (y de sus splits/asiento vinculado) del workspace; `/audit-log` sigue con rol mínimo EDITOR.

## Implementación (2026-10-03, owner ausente — decisiones registradas aquí)

Estado: dominio, persistencia, aplicación y API implementados en `packages/contexts/transactions` (+ migración `20261003200000_txn_transactions_core.sql`, cableado en `apps/api/src/identity/identity-wiring.ts`). Pendientes: UI (grupo 6), E2E y benchmarks (7.2–7.3), documentación (grupo 8), contract tests HTTP de `/transactions*` (5.1–5.3: el módulo está montado y validado por las convenciones globales, pero sin `apps/api/test/api/transactions.api.test.ts` todavía; TC-TRANSACTIONS-HISTORY-002 y TC-AUDIT-ACCESS-002 quedan sin automatizar), seeds del perfil `minimal`.

Decisiones tomadas durante la implementación:

1. **Preguntas abiertas** resueltas con las propuestas del diseño y docs/31: ajuste en cero no permitido (D17, `AMOUNT_NOT_POSITIVE`); `reconciled → void` exige des-reconciliar (D16, `TRANSACTION_RECONCILED`); sobre-reembolso exige `confirmRefundExceedsOriginal` (se audita `confirmedRefundExcess`); sin evento `TransactionCleared` (se usa `TransactionUpdated` con `changedFields=[status]`).
2. **Ids de split estables entre revisiones** cuando la lista no se reemplaza: si una edición cambia solo el monto de una transacción con un único split, el split conserva su id y se actualiza su monto (los montos históricos quedan en los postings del asiento revertido). Si `splits` llega con la misma forma (mismo número y montos) se trata como reclasificación (ids conservados, INV-033); cualquier otro reemplazo crea splits nuevos y marca los anteriores con `superseded_in_revision`. Cambiar el monto de una transacción con ≥ 2 splits sin reenviar `splits` ⇒ `SPLITS_DO_NOT_SUM` (el servidor nunca reparte en silencio).
3. **Legs persistidos** en `txn.transaction_leg` con `account_nature` (el signo de un ADJUSTMENT depende de la naturaleza: INCREASE = débito en ASSET, crédito en LIABILITY); al repostear se supersede el leg anterior.
4. **Búsqueda `q` sin `unaccent`/`pg_trgm`**: ninguna migración crea extensiones (el rol `pf_migrator` no es superusuario). `search_text` es una columna normal que la aplicación llena con descripción + notas normalizadas (minúsculas, sin acentos, NFD); `q` se normaliza igual y se busca con `LIKE`. La búsqueda por nombre de contraparte queda pendiente (requiere resolver nombres → ids vía Classification). Revisitar con NFR-PERF-001 (índice trigram) cuando se resuelva el rol de extensiones.
5. **Categoría por defecto**: se añadió a `@pf/classification/contracts` la interfaz aditiva `ClassificationLookup` (`systemCategoryId`, `categoryIdsWithDescendants`) para obtener *Uncategorized*/*Uncategorized income* y las subcategorías del filtro `categoryId`. Un reembolso vinculado sin `splits` usa la categoría del primer split del gasto original (docs/09 §6.5).
6. **`paymentMethod`** (D27) se guarda y audita, no altera asientos ni `changedFields` de `TransactionUpdated.v1` (su enum no lo incluye): va como campo aditivo `paymentMethod` del payload; si una edición cambia solo `paymentMethod` no se emite `TransactionUpdated` (sí se audita).
7. **Concurrencia**: `If-Match` desfasado contra la versión leída ⇒ `PRECONDITION_FAILED` (412); carrera detectada en `UPDATE … WHERE version = :v` ⇒ `CONCURRENCY_CONFLICT` (409). El lote `mark-cleared` toma `FOR UPDATE` de todos los ítems, responde 412 con un `errors[]` por ítem desfasado y es all-or-nothing; el `bulkOperationId` va como cambio `bulkOperationId` en cada `AuditLog` (allow-list `TRANSACTIONS_AUDIT_POLICY`).
8. **Historial (D28)**: `getTransactionHistory` usa `AuditHistoryQuery.historyOf` con la transacción y los asientos de `transaction_journal_link` (`aggregateType=JournalEntry`).
9. **INV-021 en BD**: constraint trigger diferido `txn.assert_splits_sum()` sobre `transaction` y `transaction_split` (solo INCOME/EXPENSE/REFUND), `ERRCODE 23514`.
