# Propuesta: add-transaction-recording

## Why

Registrar ingresos y gastos es el uso diario del producto y la fuente de todas las respuestas del Home (¿cuánto ingresó?, ¿cuánto gasté?). Hasta ahora el ledger, las cuentas y la clasificación solo existen como capacidades aisladas; falta el documento de negocio que el usuario realmente registra —la transacción— con su ciclo de estados, sus splits clasificados y su traducción automática, balanceada e inmutable a asientos. Este change materializa FR-TRANSACTIONS-001..017, 026..029 y 031 (Phase 1) sobre las decisiones de ARCHITECTURE §4 y docs/09.

## What Changes

- Registro de transacciones `income`, `expense`, `refund` y `adjustment` en la moneda de la cuenta, con fecha de negocio (fecha contable) y fecha de posteo bancaria informativa, descripción, contraparte, notas, origen y referencia externa.
- Ciclo de estados `pending → posted → cleared → reconciled` y `void`, con transiciones validadas: `pending` y `void` nunca tienen asiento activo (INV-023); `posted`, `cleared` y `reconciled` tienen exactamente uno.
- Posteo síncrono: al quedar `posted`, Transactions pide el asiento al Ledger por el puerto `LedgerPostingPort` dentro de la misma transacción de BD que el `AuditLog` y los eventos de outbox.
- Splits obligatorios para la porción nominal (default *Uncategorized*), que suman exactamente el monto (INV-021); reparto por porcentaje/partes iguales con mayor residuo determinista.
- Edición financiera = reversa + nuevo asiento con revisión/versión nuevas; edición descriptiva o de clasificación = sin tocar el ledger (INV-033); bloqueo optimista con `If-Match`.
- Anulación = reversa (sin borrado físico); reembolsos que reducen el gasto de la categoría original (con confirmación si exceden el original); ajustes contra `EQUITY:ADJUSTMENTS:<CCY>` con motivo obligatorio.
- Rechazo de movimientos (incluidas reversas) sobre cuentas archivadas o cerradas (INV-026).
- Listado con filtros y paginación por cursor, búsqueda de texto (Should), historial de cambios visible y duplicar transacción (Could).
- Reconciliación simple de Phase 1: marcar/desmarcar `cleared` (individual y en lote atómico), marcar `reconciled`, protección de las reconciliadas y des-reconciliación explícita auditada.
- Advertencia no bloqueante de posibles duplicados en la entrada manual (consulta previa + advertencia en la respuesta).
- **Fuera de alcance:** transferencias (`add-transfers`), conversiones (`add-manual-conversions`), saldos iniciales (orquestados por `add-accounts-management`), sesiones de reconciliación con saldo de extracto y ajuste de diferencia (FR-TRANSACTIONS-030, Phase 2), detección/resolución de duplicados en imports (FR-TRANSACTIONS-032, Phase 6), bulk edit (Phase 2), custom fields (Phase 2), vínculos a metas/préstamos/recurrencias/adjuntos (fase de cada contexto), cierre de periodos y `PERIOD_CLOSED` (Phase 2), ajuste informativo en cero (pregunta abierta).

## Capabilities

### New Capabilities
- `transactions/transaction-recording`: registro, estados, posteo atómico, edición con reversa, anulación, reembolsos, ajustes, cuentas no activas, listado, búsqueda, historial y duplicado de transacciones.
- `transactions/splits`: splits obligatorios que suman el total, reparto determinista, cambio de montos con reversa y reclasificación sin ledger.
- `transactions/reconciliation`: subconjunto Phase 1 — marcado `cleared` (individual y en lote), `reconciled` simple, protección y des-reconciliación.
- `transactions/duplicate-detection`: subconjunto Phase 1 — advertencia de posibles duplicados en la entrada manual.

### Modified Capabilities
- Ninguna.

## Impact

**Specs impactadas:** crea `transactions/transaction-recording` (23 requirements), `transactions/splits` (6), `transactions/reconciliation` (5), `transactions/duplicate-detection` (1).

**Componentes/contextos impactados:** contexto TRANSACTIONS (`@pf/transactions`: domain, application, infrastructure, interface) — agregado `Transaction`, servicios `TransactionPostingTranslator`, `SplitAllocator`, `DuplicateDetector`; puertos `LedgerPostingPort` (Ledger, síncrono), `AccountDirectory` (Accounts, query), `ClassificationValidator` (Classification, query), `AuditPort`. `apps/api` (controllers) y `apps/web` (formulario de transacción, registro, detalle con historial).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — cambios en `createTransaction`, `updateTransaction`, `voidTransaction`, `postTransaction`, `listTransactions`; nuevas operaciones `markTransactionsCleared`, `unreconcileTransaction`, `checkTransactionDuplicates`; nuevos schemas `TransactionWarning`, `TransactionCreateResult`, `ClearedMarkRequest`, `UnreconcileRequest`, `DuplicateCheckRequest`; nuevos códigos `REFUND_EXCEEDS_ORIGINAL`, `ACCOUNT_CLOSED`; el historial reutiliza `GET W/audit-log` de `add-audit-trail`. Detalle exacto en design.md § Contratos.

**Tablas impactadas:** `txn.transaction`, `txn.transaction_leg`, `txn.transaction_split`, `txn.split_tag`, `txn.transaction_journal_link` (nuevas, schema `txn`); lectura de `ledger.*` vía puerto; escritura en `audit.audit_log`, `platform.outbox`, `platform.idempotency_key`.

**Eventos impactados:** produce `transactions.TransactionCreated.v1`, `transactions.TransactionPosted.v1`, `transactions.TransactionVoided.v1`, `transactions.TransactionCategorized.v1` (cambios aditivos) y nuevo `transactions.TransactionUpdated.v1`; el Ledger produce `ledger.JournalEntryPosted.v1` por cada asiento/reversa.

**Migraciones requeridas:** expand-only, no destructiva: creación del schema `txn` con sus tablas, constraints (INV-021, INV-023), índices, grants y políticas RLS por `workspace_id`.

**Invariantes afectadas:** INV-001, INV-002, INV-003, INV-004, INV-005, INV-006, INV-007, INV-008, INV-019, INV-020, INV-021, INV-022, INV-023, INV-024, INV-025, INV-026, INV-027, INV-029, INV-033.

**Test cases:** AÑADIDOS — TC-TRANSACTIONS-INCOME-001, TC-TRANSACTIONS-EXPENSE-001, TC-TRANSACTIONS-FIELDS-001, TC-TRANSACTIONS-DATES-001, TC-TRANSACTIONS-CURRENCY-001, TC-TRANSACTIONS-AMOUNT-001, TC-TRANSACTIONS-AMOUNT-002, TC-TRANSACTIONS-STATUS-001, TC-TRANSACTIONS-POSTING-001, TC-TRANSACTIONS-EDIT-002, TC-TRANSACTIONS-CONCURRENCY-001, TC-TRANSACTIONS-REFUND-002, TC-TRANSACTIONS-ADJUSTMENT-001, TC-TRANSACTIONS-ARCHIVED-001, TC-TRANSACTIONS-LIST-001, TC-TRANSACTIONS-HISTORY-001, TC-TRANSACTIONS-SPLIT-002, TC-TRANSACTIONS-SPLIT-003, TC-TRANSACTIONS-SPLIT-004, TC-TRANSACTIONS-SPLIT-005, TC-TRANSACTIONS-SPLIT-006, TC-TRANSACTIONS-CLEARED-001, TC-TRANSACTIONS-CLEARED-002, TC-TRANSACTIONS-RECONCILED-001, TC-TRANSACTIONS-RECONCILED-002, TC-TRANSACTIONS-RECONCILED-003, TC-TRANSACTIONS-IDEMPOTENT-001 (requirement "Creación idempotente de transacciones": reenvío con la misma clave sin duplicar transacción ni asiento; payload distinto → 422 `IDEMPOTENCY_KEY_REUSED`). MODIFICADOS (requirement firme, FR real, `ready`) — TC-TRANSACTIONS-PENDING-001, TC-TRANSACTIONS-EDIT-001 (el caso de versión obsoleta pasa a CONCURRENCY-001), TC-TRANSACTIONS-VOID-001 (código `INVALID_STATUS_TRANSITION`), TC-TRANSACTIONS-REFUND-001, TC-TRANSACTIONS-SPLIT-001 (código `SPLITS_DO_NOT_SUM`), TC-TRANSACTIONS-DUPLICATE-001 (solo advertencia, ventana ±3 días). REFERENCIADO sin modificar (dueño: `add-api-conventions`) — TC-TRANSACTIONS-IDEMPOTENCY-001 para el requirement "Creación idempotente de transacciones". DEPRECADOS — ninguno. AÑADIDOS (2026-10-02, decisiones D27/D28 del owner): TC-TRANSACTIONS-PAYMETHOD-001, TC-TRANSACTIONS-PAYMETHOD-002, TC-TRANSACTIONS-QR-001, TC-TRANSACTIONS-QR-002, TC-TRANSACTIONS-HISTORY-002.

**Impacto de regresión:** primer slice que escribe en el ledger desde un documento de negocio; entra en la Financial Regression Suite. Depende de y ejercita `ledger/journal-posting`, `accounts/account-management`, `classification/categories` y `audit/audit-trail`; cualquier cambio posterior en el traductor de postings debe pasar todos los TC `regression_suite: true` de este change.

**Riesgos introducidos:** desalineación legs ↔ postings (INV-024) en el traductor — mitigado con PBT; contención de bloqueo por versión en ediciones concurrentes; latencia del comando de escritura (NFR-PERF-003) por la suma de posting + audit + outbox en una transacción; códigos de error nuevos aún no catalogados hasta que se consolide el contrato.
