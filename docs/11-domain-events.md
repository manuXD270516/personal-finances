# 11 — Catálogo de eventos de dominio

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Relacionado:** [ARCHITECTURE.md](ARCHITECTURE.md) §7 · [05-bounded-contexts.md](05-bounded-contexts.md) · [06-context-map.md](06-context-map.md) · [09-ledger-design.md](09-ledger-design.md) · [`contracts/events/`](../contracts/events/README.md) · ADR-0008 (outbox) · ADR-0016 (testing)

Catálogo de eventos publicados entre bounded contexts vía **transactional outbox**. Los eventos son hechos pasados, inmutables y versionados. Los JSON Schema de Phase 1 están en `contracts/events/`.

## 1. Envelope

Definido en ARCHITECTURE §7; schema: `contracts/events/envelope.v1.schema.json`.

| Campo | Tipo | Descripción |
|---|---|---|
| `eventId` | UUIDv7 | Identidad única del evento; clave de idempotencia del consumidor (`platform.inbox`). |
| `eventType` | string `<context>.<EventName>` | Ej. `transactions.TransactionPosted`. El **nombre completo** del evento es `<eventType>.v<eventVersion>` (`transactions.TransactionPosted.v1`). |
| `eventVersion` | integer ≥ 1 | Versión mayor del payload. |
| `occurredAt` | RFC 3339 UTC | Momento en que ocurrió el hecho (commit del comando). |
| `workspaceId` | UUID | Tenant; los consumidores fijan `app.workspace_id` (RLS) con él. |
| `aggregateType` | string | Ej. `Transaction`, `JournalEntry`, `Account`. |
| `aggregateId` | UUID | ID del agregado. |
| `aggregateVersion` | integer ≥ 1 | Versión del agregado tras el cambio; orden por agregado. |
| `correlationId` | UUID | Request/flujo original (propagado). |
| `causationId` | UUID \| null | `eventId` o ID de comando que causó éste. |
| `actor` | `{type: USER\|SYSTEM\|SERVICE, id: string\|null}` | Quién originó el cambio. |
| `payload` | object | Específico del evento. |

Convenciones de payload: camelCase; dinero `{amount: string, currency: string}` (string decimal a la escala de la moneda, firmado sólo donde se indique); fechas de negocio `YYYY-MM-DD`; instantes RFC 3339 UTC; IDs UUID; enums en MAYÚSCULAS. Payloads **autocontenidos** para los consumidores conocidos (evitar callbacks), pero sin PII innecesaria.

## 2. Garantías de entrega

- **Producción**: el evento se inserta en `platform.outbox` en la **misma transacción** que el cambio de estado. Si no hay commit, no hay evento.
- **Relay**: proceso en `worker` (rol `pf_worker`, una sola réplica activa por advisory lock) lee outbox (orden por `sequence`, `FOR UPDATE SKIP LOCKED`), encola en **pg-boss** dentro de la misma transacción (una cola `events.<consumer>` por consumidor, `key_strict_fifo` por `aggregateId`, job `id = eventId`) y marca `published_at`. At-least-once (ADR-0008 con enmienda; as-built en `openspec/changes/add-event-outbox`).
- **Consumo**: handler idempotente; `platform.inbox(consumer, event_id)` insertado en la misma transacción que el efecto del handler; duplicado ⇒ no-op.
- **Orden**: garantizado **sólo por agregado** (`aggregateId` + `aggregateVersion`). Los consumidores que necesiten orden detectan huecos (`aggregateVersion` esperado) y reintentan/aplazan; no se asume orden entre agregados.
- **Reintentos**: backoff exponencial (p. ej. 5 intentos: 1 s, 10 s, 1 min, 10 min, 1 h); luego **dead-letter** (§6).

## 3. Catálogo

Leyenda: **Ord.** = ámbito de orden; **Idem.** = clave de idempotencia del consumidor (siempre `eventId`; se indica además la clave natural para deduplicar efectos de negocio). PII: **N** ninguna, **B** baja (texto libre del usuario: descripciones/nombres), **M** media (datos que identifican cuentas/personas).

### 3.1 Evaluación de los eventos solicitados

| Evento | Veredicto | Motivo |
|---|---|---|
| `transactions.TransactionCreated` | **Mantener** (Phase 1) | Dispara Rules (incl. pending/importadas), matching en Commitments, proyecciones de pendientes. |
| `transactions.TransactionUpdated` | **Mantener, acotado** (Phase 1) | Sólo cambios no cubiertos por eventos específicos (descripción, notas, contraparte, fecha/monto de pending, amend de posted). Incluye `changedFields`. No se usa para recategorización. |
| `transactions.TransactionPosted` | **Mantener** (Phase 1) | Hecho contable relevante para negocio (actuals de presupuesto, reporting). Se emite también tras un amend (nueva revisión). |
| `transactions.TransactionVoided` | **Mantener** (Phase 1) | Revertir efectos derivados (actuals, aportes, ocurrencias). |
| `transactions.TransactionCategorized` | **Mantener** (Phase 1) | Recategorización no toca el ledger; consumidores (Planning, Reporting) necesitan el delta por split. |
| `transactions.TransferCompleted` | **Mantener** (Phase 1) | Redundante con `TransactionPosted(kind=TRANSFER)` para proyecciones, **pero** expresa el hecho de negocio que Goals y Debt escuchan (aporte a cuenta vinculada, pago de tarjeta/préstamo hecho a mano), y también se emite cuando dos transacciones importadas se **emparejan** como transferencia. |
| `transactions.ConversionRecorded` | **Mantener** (Phase 1) | Lleva `ConversionDetail` (tasas, fees, spread) para FX (observación de tasa) y Reporting (historial de conversiones). Una sola vez por conversión (docs/31 D48). |
| `transactions.ConversionRevised` | **Agregar** (Phase 1, docs/31 D48) | Corrección financiera de una conversión posteada (transición `REVISE`), simétrico a `TransferRevised`: detalle nuevo + asientos revertido, de reversa y nuevo. |
| `ledger.JournalEntryPosted` | **Mantener** (Phase 1) | Fuente de proyecciones de saldo en Reporting; incluye reversas. |
| `accounts.AccountOpened` / `AccountArchived` | **Mantener** (Phase 1) | Proyecciones (lista de cuentas en dashboard, net worth), réplicas locales futuras. Ledger **no** los necesita (get-or-create). |
| `accounts.AccountUpdated` / `AccountClosed` / `AccountReactivated` | **Agregar** (Phase 1, docs/31) | Ciclo de vida completo de la cuenta (`ACTIVE`/`CLOSED`/`ARCHIVED`) para proyecciones del dashboard. |
| `classification.CategoryArchived` | **Agregar** (Phase 1, `add-classification`) | Reporting marca categorías archivadas; Planning y Rules lo consumen desde sus fases. |
| `classification.CustomFieldDefinitionChanged` | **Agregar** (Phase 2, `add-custom-fields`) | Una definición de custom field se definió, modificó, archivó o desarchivó; invalida cachés de definiciones. Los valores no viajan en eventos: sus cambios van en `transactions.TransactionUpdated` / `accounts.AccountUpdated` con `customFields` en `changedFields`. |
| `fx.RateRecorded` | **Adelantar** a Phase 1 (`add-manual-conversions`, `add-market-rate-providers`) | Tasas manuales y de providers (D29) invalidan el resumen valorizado. |
| `identity.WorkspaceCreated` / `WorkspaceSettingsChanged` | **Mantener** (Phase 1) | Siembra de categorías (Classification) y de preferencias/histórico de tasas (FX); Reporting reacciona a moneda base, zona horaria y mes fiscal. Planning (Phase 2, `add-financial-periods`) crea los periodos iniciales de forma asíncrona y recalcula los `DRAFT` ante `fiscalMonthStartDay` (y activa ante `timeZone`); también consume `ledger.JournalEntryPosted` para cubrir fechas fuera de los periodos existentes. |
| `commitments.RecurringOccurrenceGenerated` | **Reemplazar** por `commitments.OccurrencesGenerated` (batch por definición y ventana) | Un evento por ocurrencia genera ruido (cientos por ventana). El calendario de flujo de caja sólo necesita el lote. `RecurringOccurrenceDue` (uno por ocurrencia) sí es útil para recordatorios. |
| `planning.BudgetThresholdReached` | **Mantener** (Phase 2, `add-budgets`) | Hecho de negocio para Notify; dedup **por objetivo** (periodo, categoría/grupo/tag, umbral): quitar y volver a agregar la línea no re-alerta. Payload ajustado a la terminología del plan por periodo (`budgetLineId`/`periodLabel`/`reference`, no `budgetItemId`/`yearMonth`/`planned`). Lo emiten el consumidor `planning.budget-thresholds` (suscrito a `TransactionPosted/Voided/Categorized/Updated`, `TransferCompleted/Revised`, `ConversionRecorded/Revised` y `fx.RateRecorded`) y la edición síncrona de la línea; cada hecho sube la versión del agregado `Budget` (el outbox exige una versión distinta por evento). El consumidor `planning.rollover-finalizer` consume `planning.MonthClosed.v1` / `planning.PeriodReopened.v1` para congelar o devolver a provisional el remanente trasladado. |
| `planning.BudgetCreated` | **Agregar** (Phase 2, `add-budgets`) | Se creó el plan de un periodo (vacío, desde una versión de template —también el predeterminado de un periodo nuevo— o clonado del periodo anterior; `add-budget-templates` agrega los orígenes `TEMPLATE` y `CLONE`, sin eventos nuevos). |
| `goals.SavingsContributionRecorded` | **Mantener** (Phase 4) | Reporting/Notify. |
| `goals.GoalReached` | **Mantener** (Phase 4) | Notify. |
| `debt.LoanInstallmentGenerated` | **Reemplazar** por `debt.LoanScheduleGenerated` | El cronograma se genera completo (y se regenera por versión); un evento por cuota es ruido. Recordatorios usan `CardPaymentDue`/`LoanInstallmentDue` (job diario). |
| `debt.LoanPaymentRecorded` | **Mantener** (Phase 4) | Reporting (deuda), Notify. |
| `documents.AttachmentUploaded` | **Mantener** (Phase 6) | Imports (archivo listo), escaneo completado. |
| `imports.ImportCompleted` | **Mantener** (Phase 6) | Notify, Reporting (refrescar), métricas. |
| `planning.PeriodActivated` | **Mantener** (Phase 2, `add-financial-periods`) | Un periodo `DRAFT` pasa a `ACTIVE` (automático por fecha en la zona del workspace o manual). Reporting (rótulo del periodo en curso) y Notify ("empezó el mes"), ambos opcionales. Los periodos creados ya iniciados nacen `ACTIVE` sin evento. |
| `planning.MonthClosed` | **Mantener** (Phase 2) | Reporting (congelar series), Forecast (recalcular), Notify. |
| `planning.PeriodReopened` | **Mantener** (Phase 2) | Reporting (invalidar), Audit visible, Forecast. |
| `forecast.ForecastRequested` | **Descartar como evento de integración** | Es un comando/job interno de Forecast (cola BullMQ), no un hecho que interese a otros contextos. |
| `forecast.ForecastGenerated` | **Mantener** (Phase 8) | Notify, Reporting (mostrar). |
| `commitments.SubscriptionPriceChanged` | **Mantener** (Phase 3) | Notify (alerta de aumento), Reporting. |

### 3.2 Phase 1 (con JSON Schema)

#### `transactions.TransactionCreated.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** RULES, COMMITMENTS (auto-match), REPORTING (pendientes).
- **Trigger:** cualquier `Record*` o `ImportTransactions` acepta una transacción (pending o posted).
- **Payload:** `transactionId: uuid`, `kind: TransactionKind`, `status: PENDING|POSTED|CLEARED`, `businessDate: date`, `postingDate: date|null`, `description: string|null`, `counterpartyId: uuid|null`, `origin: {type: MANUAL|IMPORT|RECURRING|DEBT|GOAL|SYSTEM, refId: uuid|null}` (mismo enum que el OpenAPI), `legs: [{accountId: uuid, amount: Money(firmado)}]`, `splits: [{splitId, amount: Money, categoryId|null, tagIds: uuid[]}]`, `refundOfTransactionId: uuid|null`; opcionales aditivos `paymentMethod` (D27) y `transition`.
- **Idem.:** `eventId`; natural `transactionId`. **Ord.:** por `Transaction`. **PII:** B (`description`).

#### `transactions.TransactionPosted.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** PLANNING (actuals), REPORTING, NOTIFY (opcional grandes gastos).
- **Trigger:** creación directa en `posted`, `PostTransaction` (pending→posted) o amend que repostea.
- **Payload:** `transactionId`, `revision: int`, `kind`, `businessDate`, `journalEntryId`, `previousStatus: PENDING|POSTED|CLEARED|null`, `counterpartyId|null`, `legs[]`, `splits[]`, `supersedesJournalEntryId: uuid|null` (amend).
- **Idem.:** natural `(transactionId, revision)`. **Ord.:** por `Transaction`. **PII:** N.

#### `transactions.TransactionVoided.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** PLANNING, REPORTING, GOALS, DEBT, COMMITMENTS.
- **Payload:** `transactionId`, `kind`, `businessDate`, `previousStatus: PENDING|POSTED|CLEARED`, `reversalJournalEntryId: uuid|null` (null si era pending), `reason: string|null`, `legs[]`, `splits[]` (los vigentes al anular, para que el consumidor revierta sin consultar).
- **Idem.:** natural `transactionId`. **Ord.:** por `Transaction`. **PII:** B (`reason`).

#### `transactions.TransactionCategorized.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** PLANNING, REPORTING.
- **Trigger:** `ApplyClassification` cambia la categoría o tags de ≥1 split, individualmente o en una edición masiva (`transactions/bulk-edit`: un hecho por transacción, hasta 500 por operación; los consumidores son idempotentes por `(transactionId, aggregateVersion)` y toleran la ráfaga).
- **Payload:** `transactionId`, `status`, `businessDate`, `appliedBy: USER|RULE|IMPORT`, `ruleId: uuid|null`, `changes: [{splitId, amount: Money, previousCategoryId|null, newCategoryId|null, addedTagIds[], removedTagIds[]}]`; opcional aditivo `bulkOperationId: uuid` (edición masiva, `add-bulk-edit`; igual al `correlationId` del evento y de la auditoría de la operación).
- **Idem.:** natural `(transactionId, aggregateVersion)`. **Ord.:** por `Transaction`. **PII:** N.

#### `transactions.TransferCompleted.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** GOALS, DEBT, REPORTING.
- **Trigger:** **primer** posteo de la transferencia (creación posteada o pending→posted) o emparejamiento `LinkAsTransfer`; se publica **una sola vez** por transferencia: una edición financiera publica `TransferRevised.v1` y la anulación `TransactionVoided.v1` (docs/31 D37, `add-lifecycle-timeline`). Incluye el pago de tarjeta de crédito, que es una transferencia (`kind = TRANSFER`, destino `LIABILITY`); no existe un kind propio en Phase 1 (`CARD_PAYMENT` queda reservado para `debt/credit-cards`, Phase 4).
- **Payload:** `transactionId`, `journalEntryId`, `businessDate`, `fromAccountId`, `toAccountId`, `amount: Money (positivo)`, `fee: Money|null`, `matchedTransactionIds: uuid[]` (vacío si no hubo emparejamiento).
- **Idem.:** natural `(transactionId, journalEntryId)` (equivale a `transactionId`: hay uno solo). **Ord.:** por `Transaction`. **PII:** N.

#### `transactions.TransferRevised.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** REPORTING (Phase 1, invalida el resumen); GOALS, DEBT (Phase 4).
- **Trigger:** transición `REVISE` de una transferencia posteada o cleared (monto, comisión, cuentas o fecha): reversa exacta del asiento activo + asiento nuevo con la revisión siguiente (docs/31 D37).
- **Payload:** `transactionId`, `revisionFrom`, `revisionTo`, `businessDate`, `fromAccountId`, `toAccountId`, `amount: Money (positivo)`, `fee: Money|null`, `reversedJournalEntryId`, `reversalJournalEntryId`, `journalEntryId`.
- **Idem.:** natural `(transactionId, revisionTo)`. **Ord.:** por `Transaction`. **PII:** N.

**Campo `transition` (aditivo, `add-lifecycle-timeline`).** `TransactionCreated`, `TransactionPosted`, `TransactionUpdated`, `TransactionVoided`, `AccountOpened`, `AccountClosed`, `AccountArchived` y `AccountReactivated` (v1) llevan el campo opcional `transition` con la transición de la máquina de estados que los originó (`RECORD`, `POST`, `CLEAR`, `UNCLEAR`, `RECONCILE`, `RECONCILE_WITHOUT_STATEMENT` (add-reconciliation, D74), `UNRECONCILE`, `REVISE`, `VOID`; `OPEN`, `CLOSE`, `ARCHIVE`, `REACTIVATE`). Es compatible (sin `v2`): los consumidores lo ignoran; `TransactionUpdated` no lo lleva cuando la edición es descriptiva (anotación del recorrido).

#### `transactions.ConversionRecorded.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** FX (observación de tasa), REPORTING.
- **Trigger:** **primer** posteo de la conversión (creación posteada o pending→posted); se publica **una sola vez** por conversión: una corrección financiera publica `ConversionRevised.v1` y la anulación `TransactionVoided.v1` (docs/31 D48).
- **Payload:** `transactionId`, `journalEntryId`, `businessDate`, `executedAt`, `source: {accountId, amount: Money}` (bruto), `target: {accountId, amount: Money}` (neto), `quotedRate: Rate|null`, `effectiveRate: Rate`, `referenceRate: {rate: Rate, fxRateId, source}|null`, `fees: [{type: PROVIDER|NETWORK|BANK|TAX|OTHER, amount: Money, paidFromAccountId|null}]`, `spread: {percentage: string, amount: Money}|null`, `provider: {counterpartyId|null, name|null}`. `Rate = {base, quote, value: string}`. Opcionales aditivos (`add-manual-conversions`): `revision` (1 al registrar, +1 por amend), `convertedSource`, `grossTarget`, `quotedRateDeviation|null`.
- **Sin re-emisión (docs/31 D48, 2026-10-05):** un amend (`PUT …/conversions/{transactionId}`) ya **no** vuelve a publicar este evento con `revision + 1` (comportamiento anterior de `add-manual-conversions`): publica `ConversionRevised.v1`. Una conversión `PENDING` corregida y luego posteada publica este evento una vez, con la revisión vigente al postear.
- **Idem.:** natural `(transactionId, journalEntryId)` (equivale a `transactionId`: hay uno solo). **Ord.:** por `Transaction`. **PII:** B (nombre de proveedor/persona P2P).

#### `transactions.ConversionRevised.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** REPORTING (Phase 1, `reporting.data-version` invalida el resumen; idempotente vía `platform.inbox`); FX (observación de tasa, cuando exista ese consumidor).
- **Trigger:** transición `REVISE` de una conversión posteada o cleared (montos, cuentas, fecha, tasa cotizada, referencia o fees): reversa exacta del asiento activo + asiento nuevo + `ConversionDetail` con la revisión siguiente (docs/31 D48, simétrico a `TransferRevised.v1`). La corrección de una conversión `PENDING` es una anotación y no lo publica.
- **Payload:** `transactionId`, `revisionFrom`, `revisionTo`, `businessDate`, el detalle de la revisión `revisionTo` con la misma forma que `ConversionRecorded.v1` (`executedAt`, `source`, `target`, `quotedRate|null`, `effectiveRate`, `referenceRate|null`, `fees[]`, `spread|null`, `provider`, `convertedSource`, `grossTarget`, `quotedRateDeviation|null`) y los asientos `reversedJournalEntryId`, `reversalJournalEntryId`, `journalEntryId`. Schema: `contracts/events/transactions/ConversionRevised.v1.schema.json`.
- **Idem.:** natural `(transactionId, revisionTo)`. **Ord.:** por `Transaction`. **PII:** B (nombre de proveedor/persona P2P).

#### `ledger.JournalEntryPosted.v1`
- **Productor:** LEDGER. **Consumidores:** REPORTING (saldos), GOALS (earmarks vs saldo).
- **Payload:** `journalEntryId`, `entryDate`, `entryType: STANDARD|REVERSAL|OPENING`, `sequence: string` (bigint como string), `sourceRef: {context, type, id, revision}`, `reversesEntryId|null`, `postings: [{postingId, ledgerAccountId, accountId|null, systemAccountCode|null, amount: Money (firmado), splitId|null}]`.
- **Idem.:** natural `journalEntryId`. **Ord.:** por `JournalEntry` (cada asiento es su propio agregado, versión 1); para saldos se usa `sequence`. **PII:** N.

#### `accounts.AccountOpened.v1`
- **Productor:** ACCOUNTS. **Consumidores:** REPORTING, (futuro) réplicas.
- **Payload:** `accountId`, `name`, `type: BANK|CASH|DIGITAL_WALLET|CREDIT_CARD|LOAN|CRYPTO_WALLET|INVESTMENT|SAVINGS|VIRTUAL|MANUAL_ASSET|MANUAL_LIABILITY` (mismo enum que `AccountType` del OpenAPI), `nature: ASSET|LIABILITY`, `currency`, `institutionId|null`, `openedOn: date`, `liquidity: LIQUID|SEMI_LIQUID|ILLIQUID`, `includeInNetWorth: boolean`.
- **Idem.:** natural `accountId`. **Ord.:** por `Account`. **PII:** B (`name` puede contener datos personales; no se incluye número de cuenta).

#### `accounts.AccountArchived.v1`
- **Productor:** ACCOUNTS. **Consumidores:** REPORTING, COMMITMENTS (pausar definiciones que usan la cuenta), GOALS.
- **Payload:** `accountId`, `archivedOn: date`, `reason: string|null`.
- **Idem.:** `(accountId, aggregateVersion)`. **Ord.:** por `Account`. **PII:** B.

#### `transactions.TransactionUpdated.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** REPORTING (Phase 1); PLANNING y COMMITMENTS desde sus fases.
- **Trigger:** edición descriptiva, cambio `cleared`/`reconciled` (`POST …/mark-cleared`, `PATCH` de reconciliación), des-reconciliación (`POST …/{id}/unreconcile`) o amend financiero; en el amend se emite **junto** a `TransactionPosted.v1` con `ledgerImpact = true` (`add-transaction-recording`).
- **Payload:** `transactionId`, `revision: int`, `status: PENDING|POSTED|CLEARED|RECONCILED`, `previousStatus|null`, `changedFields: string[]` (aditivo `add-reconciliation`: `reconciliationMode` en la conciliación sin extracto, la des-reconciliación y el cotejo posterior), `ledgerImpact: boolean`, `reason: string|null`; opcionales aditivos `paymentMethod`, `transition` y `bulkOperationId` (edición masiva, `add-bulk-edit`: contraparte, notas, custom fields o estado; la categoría y los tags van en `TransactionCategorized`). **Sin** montos ni valores `before/after` (los consumidores que los necesitan leen `TransactionPosted`).
- **Idem.:** natural `(transactionId, aggregateVersion)`. **Ord.:** por `Transaction`. **PII:** B (`reason`).

#### `transactions.TransactionCleared.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** ninguno obligatorio (hecho dedicado de docs/31 D47; `reporting.data-version` no necesita suscribirse: no cambia cifras).
- **Trigger:** cada transición `CLEAR` / `UNCLEAR` (`posted` ↔ `cleared`), individual, en lote, dentro de una sesión de reconciliación o desde una edición masiva. Se publica **además** de `TransactionUpdated.v1` (que sigue llevando `changedFields = [status]`): cambio aditivo (`add-reconciliation`).
- **Payload:** `transactionId`, `accountId`, `cleared: boolean`, `status: POSTED|CLEARED`, `previousStatus: POSTED|CLEARED`, `revision: int`, `reconciliationId: uuid|null` (sesión en cuyo nombre se confirmó), `bulkOperationId: uuid|null`, `transition: CLEAR|UNCLEAR`.
- **Idem.:** natural `(transactionId, aggregateVersion)`. **Ord.:** por `Transaction`. **PII:** N.

#### `transactions.ReconciliationCompleted.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** PLANNING (checklist de cierre, opcional: la consulta es síncrona por `ReconciliationStatusQuery.getCoverage`).
- **Trigger:** `COMPLETE` de la máquina `RECONCILIATION_LIFECYCLE` (`completeReconciliation`): las transacciones confirmadas hasta la fecha del extracto pasaron a `reconciled` (modo contra extracto), con un ajuste opcional contra `EQUITY:ADJUSTMENTS`. Iniciar y cancelar no publican evento.
- **Payload:** `reconciliationId`, `accountId`, `currency`, `statementDate`, `statementBalance: Money`, `clearedBalance: Money`, `transactionCount: int`, `transactionIds: uuid[]` (≤ 2 000; se omite si excede), `adjustmentTransactionId: uuid|null`, `transition: COMPLETE`.
- **Idem.:** natural `reconciliationId`. **Ord.:** por `Reconciliation`. **PII:** N.

#### `accounts.AccountUpdated.v1`
- **Productor:** ACCOUNTS. **Consumidores:** REPORTING.
- **Trigger:** cambian metadatos, liquidez, inclusión en patrimonio o la moneda (solo sin movimientos) de la cuenta.
- **Payload:** `accountId`, `changedFields: string[]` y, opcionales, los valores nuevos **no sensibles** (`name`, `institutionId|null`, `liquidity`, `includeInNetWorth`, `currency`); nunca `notes` ni identificadores de cuenta.
- **Idem.:** `(accountId, aggregateVersion)`. **Ord.:** por `Account`. **PII:** B (`name`).

#### `accounts.AccountClosed.v1`
- **Productor:** ACCOUNTS. **Consumidores:** REPORTING; COMMITMENTS (Phase 3).
- **Trigger:** `POST …/accounts/{id}/close` con saldo cero (si no, `409 ACCOUNT_BALANCE_NOT_ZERO`); la cuenta sigue visible pero no admite movimientos (INV-026).
- **Payload:** `accountId`, `closedOn: date`, `reason: string|null`; opcional `transition`.
- **Idem.:** `(accountId, aggregateVersion)`. **Ord.:** por `Account`. **PII:** B (`reason`).

#### `accounts.AccountReactivated.v1`
- **Productor:** ACCOUNTS. **Consumidores:** REPORTING.
- **Trigger:** `POST …/accounts/{id}/reactivate` de una cuenta `CLOSED` o `ARCHIVED`.
- **Payload:** `accountId`, `previousStatus: ARCHIVED|CLOSED`, `reactivatedOn: date`; opcional `transition`.
- **Idem.:** `(accountId, aggregateVersion)`. **Ord.:** por `Account`. **PII:** N.

> `AccountUpdated`, `AccountClosed`, `AccountReactivated` y `TransactionUpdated` se movieron a Phase 1 el 2026-10-02 al consolidar las specs ([31](31-phase-1-consolidation-decisions.md)); sus JSON Schemas viven en `contracts/events/`.

#### `classification.CategoryArchived.v1`
- **Productor:** CLASSIFICATION. **Consumidores:** REPORTING (Phase 1, marca "archivada" en el dashboard); PLANNING y RULES desde sus fases.
- **Trigger:** `POST …/categories/{id}/archive`. Archivar una categoría padre archiva sus subcategorías activas en la misma transacción y emite **un evento por categoría** archivada (`add-classification`).
- **Payload:** `categoryId`, `parentId|null`, `groupId`, `kind: EXPENSE|INCOME`, `archivedAt: instant`, `cascadedFromCategoryId|null` (la categoría padre cuando se archivó en cascada); opcional aditivo `transition: ARCHIVE` (transición de la máquina `Category`, docs/31 D52; los consumidores lo ignoran).
- **Idem.:** natural `(categoryId, aggregateVersion)`. **Ord.:** por `Category`. **PII:** N.

#### `classification.CustomFieldDefinitionChanged.v1`
- **Productor:** CLASSIFICATION. **Consumidores:** ninguno en Phase 2 (invalidación de cachés de definiciones; futuros export y reglas).
- **Trigger:** `POST/PATCH/archive/unarchive` de `W/custom-fields` con efecto (un parche sin cambios no emite).
- **Payload:** `fieldId`, `key`, `change: DEFINED|UPDATED|ARCHIVED|UNARCHIVED`, `dataType: TEXT|NUMBER|DECIMAL|DATE|BOOLEAN|SELECT`, `target: TRANSACTION|ACCOUNT`. Sin etiqueta ni opciones; los valores asignados a los registros nunca viajan en eventos (`TransactionUpdated.v1` y `AccountUpdated.v1` agregan `customFields` a `changedFields`, aditivo).
- **Idem.:** natural `(fieldId, aggregateVersion)`. **Ord.:** por `CustomFieldDefinition`. **PII:** N.

#### `fx.RateRecorded.v1`
- **Productor:** FX. **Consumidores:** REPORTING (invalida el resumen).
- **Trigger:** se registra una tasa histórica inmutable: manual (`POST …/fx-rates`, actor `USER`), corrección (`POST …/fx-rates/{id}/supersede`) o muestra de un provider de mercado (paralelo.bo / bo.dolarapi.com, ADR-0025, D29; actor `SYSTEM` `fx-provider:<id>`, `causationId = null`, `correlationId` = id del ciclo; un evento por workspace en cuyo historial se registró). La carga histórica emite **un único** evento por workspace y ejecución (`rateId` = última tasa insertada). Movido a Phase 1 con `add-manual-conversions`.
- **Payload:** `rateId`, `base`, `quote`, `value: string` (1 base = value quote), `rateType: OFFICIAL|PARALLEL|P2P|BANK|CUSTOM|PARALLEL_BUY|PARALLEL_SELL`, `source: MANUAL|PROVIDER|USER_CONVERSION`, `sourceLabel|null`, `asOf: instant`, `effectiveDate: date`, `supersedesRateId|null`; opcionales aditivos (`add-market-rate-providers`) `provider: PARALELO_BO|DOLARAPI_BO|null` y `anomalyFlagged: boolean`.
- **Idem.:** natural `rateId`. **Ord.:** por `ExchangeRate`. **PII:** N.

#### `identity.WorkspaceCreated.v1`
- **Productor:** IDENTITY. **Consumidores:** CLASSIFICATION (siembra categorías de sistema y, si aplica, el catálogo por defecto), REPORTING, FX (consumidor `fx.market-rate-provisioning` con inbox: siembra las preferencias `PARALLEL` de USD/BOB y USDT/BOB si el workspace no fijó su lista y encola `fx.backfill-historical-rates` con id de job = `eventId`, en la misma transacción; `add-market-rate-providers`).
- **Trigger:** alta de workspace (personal por provisión JIT o adicional del usuario).
- **Payload:** `workspaceId`, `name`, `baseCurrency`, `timeZone`, `locale`, `fiscalMonthStartDay`, `ownerUserId`, `origin: PERSONAL_DEFAULT|USER_CREATED`.
- **Idem.:** natural `workspaceId` (`aggregateVersion = 1`). **Ord.:** por `Workspace`. **PII:** B (`name`).

#### `identity.WorkspaceSettingsChanged.v1`
- **Productor:** IDENTITY. **Consumidores:** REPORTING (moneda base, zona horaria, mes fiscal).
- **Trigger:** `PATCH /workspaces/{id}` con cambios efectivos; un evento por versión del agregado.
- **Payload:** `workspaceId`, `changes: [{field: name|baseCurrency|timeZone|locale|fiscalMonthStartDay|minimumLiquidityReserve, before, after}]` (`minimumLiquidityReserve` como `Money`).
- **Idem.:** natural `(workspaceId, aggregateVersion)`. **Ord.:** por `Workspace`. **PII:** B (`name`).

#### `identity.DemoDataLoaded.v1` / `identity.DemoDataCleaned.v1` (add-demo-data, ADR-0026)
- **Productor:** IDENTITY (`DemoDataLoaded` desde el job `demo.load` del worker, actor `system:demo`, en el workspace demo; `DemoDataCleaned` desde `CleanupDemoData`, en el workspace de ORIGEN, que sobrevive a la purga). **Consumidores:** REPORTING (`DemoDataLoaded` invalida la caché del resumen); informativo.
- **Payload:** `workspaceId` (demo), `originWorkspaceId`, `datasetVersion`. Sin datos financieros.
- **Idem.:** natural `workspaceId`. **Ord.:** por `Workspace`. **PII:** ninguna.
- **Workspaces retirados:** los consumidores ignoran (no-op, sin fila de inbox) los eventos de un workspace demo archivado o purgado (`platform.workspace_is_retired`).

#### `identity.WorkspaceExportCompleted.v1` / `identity.WorkspaceRestored.v1` (add-workspace-export, Phase 2)
- **Productor:** IDENTITY (job `identity.workspace-export` del worker, actor `SYSTEM`; la importación se publica desde el job `identity.workspace-import`, en el workspace NUEVO). **Consumidores:** ninguno obligatorio (informativo; el aviso al usuario lo muestra la UI, no un consumidor de NOTIFY).
- **Payload:** `WorkspaceExportCompleted`: `workspaceId`, `exportId`, `status`, `expiresAt`, `requestedBy`. `WorkspaceRestored`: `workspaceId` (nuevo), `importId`, `sourceWorkspaceId`, `sourceExportedAt`. Sin datos financieros ni nombres.
- **Idem.:** natural `exportId` / `importId`. **Ord.:** por `Workspace`. **PII:** ninguna. Esquemas en `contracts/events/identity/`.

#### Consumidores de NOTIFY (add-alerts, Phase 2)
- **`notifications.budget-threshold`** (cola `events.notifications.budget-threshold`): consume `planning.BudgetThresholdReached.v1`; destinatarios: todo miembro activo (OWNER, EDITOR, VIEWER; docs/33 D89). Clave de deduplicación de negocio por destinatario: `budget-threshold:<periodId>:<targetKind>:<targetId>:<threshold>`.
- **`notifications.month-close-pending`** (cola `events.notifications.month-close-pending`): consume `planning.MonthClosePending.v1`; destinatarios: OWNER y EDITOR. Clave: `month-close-pending:<periodId>`.
- **Idempotencia en dos capas (INV-028)**: `platform.inbox (consumer, eventId)` en la transacción del consumidor + `UNIQUE (workspace_id, user_id, dedupe_key)` con `ON CONFLICT DO NOTHING`; un segundo evento del mismo hecho con otro `eventId` no duplica. La entrega por email se crea solo si la notificación se insertó y su job `notifications.email-dispatch` se encola en la misma transacción.
- **Fallo**: un payload mal formado reintenta y termina en `platform.dead_letter` del consumidor (no bloquea a los demás); la caída del SMTP no afecta a los consumidores (cola propia `notifications.email-dispatch`).
- **Métricas**: `notifications_created_total{type}`, `notifications_email_deliveries_total{status}` (`sent|retry|failed|suppressed`) y el histograma `notifications_event_lag` (evento → notificación in-app, NFR-PERF-008).

### 3.3 Fases posteriores (schemas se crean al implementar)

| Evento | Productor | Consumidores | Trigger | Payload (resumen) | Idem. natural | PII |
|---|---|---|---|---|---|---|
| `commitments.OccurrencesGenerated.v1` | COMMITMENTS | REPORTING | Job de ventana | `definitionId, window: DateRange, occurrences: [{occurrenceId, occurrenceDate, dueDate, expectedAmount: Money}]` | `(definitionId, window)` | N |
| `commitments.RecurringOccurrenceDue.v1` | COMMITMENTS | NOTIFY | Ocurrencia pasa a `due` | `occurrenceId, definitionId, dueDate, expectedAmount, name` | `occurrenceId` | B |
| `commitments.RecurringOccurrenceMaterialized.v1` | COMMITMENTS | REPORTING | Confirm/match | `occurrenceId, transactionId, mode: CREATED\|MATCHED` | `occurrenceId` | N |
| `commitments.SubscriptionPriceChanged.v1` | COMMITMENTS | NOTIFY, REPORTING | `ChangeSubscriptionPrice` | `subscriptionId, counterpartyId, previousPrice: Money, newPrice: Money, effectiveFrom, changePercentage: string` | `(subscriptionId, effectiveFrom)` | N |
| `planning.PeriodActivated.v1` (**schema publicado**: `contracts/events/planning/PeriodActivated.v1.schema.json`, add-financial-periods) | PLANNING | REPORTING, NOTIFY (opcionales) | `ActivateDuePeriods` (job `planning.ensure-periods`) o `ActivatePeriod` | `workspaceId, periodId, label, periodStart, periodEnd, startDay, isTransition, activatedAt, activation: AUTOMATIC\|MANUAL` | `(periodId, 'ACTIVATED')` | N |
| `planning.BudgetCreated.v1` (**schema publicado**: `contracts/events/planning/BudgetCreated.v1.schema.json`, add-budgets) | PLANNING | REPORTING, NOTIFY (opcionales) | `CreateBudget` | `budgetId, periodId, periodLabel, currency, origin: EMPTY\|TEMPLATE\|CLONE, templateId\|null, templateVersionNo\|null, clonedFromBudgetId\|null, lineCount` | `(periodId)` | N |
| `planning.BudgetThresholdReached.v1` (**schema publicado**: `contracts/events/planning/BudgetThresholdReached.v1.schema.json`, add-budgets) | PLANNING | NOTIFY | El gastado de una línea de gasto cruza un umbral (consumidor `planning.budget-thresholds` o edición síncrona de la línea) | `budgetId, budgetLineId, periodId, periodLabel, periodStart, periodEnd, target: {kind: CATEGORY\|GROUP\|TAG, id}, threshold: string (el más alto), alsoCrossed: string[], reference: Money, actual: Money, utilization: string, actualComplete: boolean, crossedAt` | `(periodId, target.kind, target.id, threshold)` — **una sola vez** por objetivo, umbral y periodo (tabla de cruces append-only + outbox en la misma transacción); un cambio que cruza varios umbrales emite UN hecho con el más alto y `alsoCrossed` (docs/33 D80) | N |
| `planning.MonthClosed.v1` | PLANNING | PLANNING/budgets, REPORTING, FORECAST | `CloseMonth` | `periodId, label, periodStart, periodEnd, closeNo, snapshotId, previousSnapshotId, closedAt, closedBy, baseCurrency, totalsByCurrency[], consolidated, balances[], netWorth` | `(periodId, closeNo)` | N |
| `planning.PeriodReopened.v1` | PLANNING | PLANNING/budgets, REPORTING, FORECAST | `ReopenPeriod` | `periodId, label, periodStart, periodEnd, reopenNo, reason, reopenedBy, reopenedAt, closedSnapshotId` | `(periodId, reopenNo)` | B |
| `planning.MonthClosePending.v1` | PLANNING | NOTIFY | job `planning.close-pending` | `periodId, periodLabel, periodStart, periodEnd, pendingSince, delayDays` | `periodId` (una vez por periodo) | N |
| `goals.SavingsContributionRecorded.v1` | GOALS | REPORTING, NOTIFY | Aporte/retiro/earmark | `goalId, contributionId, type, amount: Money, transactionId\|null, sourceAccountId\|null, progress: Money, target: Money` | `contributionId` | N |
| `goals.GoalReached.v1` | GOALS | NOTIFY, REPORTING | progress ≥ target | `goalId, target, progress, reachedOn` | `(goalId, aggregateVersion)` | B (nombre meta) |
| `debt.LoanScheduleGenerated.v1` | DEBT | REPORTING (calendario) | Desembolso/recálculo | `loanId, scheduleVersion, installments: [{n, dueDate, principal, interest, fees, insurance, taxes, total}]` | `(loanId, scheduleVersion)` | N |
| `debt.LoanPaymentRecorded.v1` | DEBT | REPORTING, NOTIFY | `RecordLoanPayment` | `loanId, installmentNos[], transactionId, breakdown: {principal, interest, fees, insurance, taxes, total}: Money, remainingPrincipal: Money` | `(loanId, transactionId)` | N |
| `documents.AttachmentUploaded.v1` | DOCUMENTS | IMPORTS, REPORTING | Escaneo OK | `documentId, contentType, sizeBytes, sha256, purpose` (sin filename) | `documentId` | N |
| `imports.ImportCompleted.v1` | IMPORTS | NOTIFY, REPORTING | Commit terminado | `importJobId, accountId, sourceType, stats: {total, imported, duplicates, ignored, errors}, dateRange` | `importJobId` | N |
| `forecast.ForecastGenerated.v1` | FORECAST | NOTIFY, REPORTING | Corrida exitosa | `forecastRunId, scope, horizonMonths, modelName, modelVersion, summary` | `forecastRunId` | N |
| `classification.CategoriesMerged.v1` | CLASSIFICATION | TRANSACTIONS, PLANNING, RULES, REPORTING | `MergeCategories` | `sourceCategoryIds[], targetCategoryId` | `(targetCategoryId, aggregateVersion)` | N |

## 4. Versionado y evolución

1. **Cambios aditivos** (campo opcional nuevo, nuevo valor de enum **sólo si** los consumidores toleran desconocidos, nuevo evento): misma versión. Se actualiza el schema y el ejemplo. Los consumidores siguen el patrón *tolerant reader* (ignoran campos desconocidos; enums desconocidos ⇒ rama "otro"/ignorar).
2. **Cambios breaking** (renombrar/eliminar campo, cambiar tipo o semántica, campo obligatorio nuevo, cambiar unidad/signo): **nueva versión** `vN+1` con nuevo schema en `contracts/events/<context>/<EventName>.v<N+1>.schema.json`.
3. **Publicación dual**: durante la transición el productor publica `vN` y `vN+1` (dos filas de outbox, misma transacción) hasta que todos los consumidores migren; mínimo 1 release y documentado en el changelog del contrato. Luego `vN` se marca `deprecated` en su schema y se elimina.
4. Los schemas de una versión publicada sólo admiten cambios aditivos; CI compara contra `main` (diff de JSON Schema) y falla ante cambios incompatibles.
5. El envelope sólo cambia por ADR.

## 5. Testing de contratos

- **Productor**: cada evento tiene un *test de contrato* que construye el evento desde el agregado (fixture de dominio) y lo valida con Ajv (draft 2020-12, `strict`, `formats`) contra su schema. Naming: `it('[TC-<CTX>-EVENTS-NNN] TransactionPosted v1 matches schema', …)`.
- **Consumidor**: tests con los `examples` del schema + variantes con campos extra (tolerant reader) y duplicados (idempotencia).
- **Compatibilidad**: job de CI que compara schemas modificados vs `main` y clasifica el cambio (aditivo / breaking); breaking sin nueva versión ⇒ fallo.
- **Cobertura**: test de arquitectura que verifica que todo `eventType` emitido en código tiene schema y viceversa.
- **PBT**: generadores de payloads válidos (fast-check desde el schema) para probar handlers (INV-028).

## 6. Outbox, inbox, dead-letter y replay (conceptual)

| Tabla (`platform`) | Columnas conceptuales | Notas |
|---|---|---|
| `outbox` | `id (=eventId)`, `sequence` (identity), `workspace_id`, `event_type`, `event_version`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `occurred_at`, `correlation_id`, `envelope jsonb`, `trace_context jsonb`, `created_at`, `published_at null`, `publish_attempts`, `last_error` | Insert en la misma tx del comando. Relay por `sequence`. Retención de publicados 7 días (purga horaria). |
| `inbox` | `consumer`, `event_id`, `processed_at` · PK `(consumer, event_id)` | Insert en la tx del handler. |
| `dead_letter` | `consumer`, `event_id`, `envelope`, `error`, `attempts`, `first_failed_at`, `last_failed_at`, `status (OPEN\|REPLAYED\|DISCARDED)` | Tras agotar reintentos. Alerta (métrica `events_dead_lettered_total`). |

- **Dead-letter**: el evento problemático no bloquea otros agregados; para el mismo agregado, el consumidor que exige orden **pausa** ese agregado hasta resolución. Operación: comando admin `ReplayDeadLetter(id)` / `DiscardDeadLetter(id, reason)` (auditados).
- **Replay**: proyecciones (Reporting, actuals de Planning) se reconstruyen (a) desde `outbox` retenido, o (b) — preferido — desde las tablas fuente vía `RebuildProjection` (las proyecciones son funciones de los datos). Replay = reprocesar con un `consumer` nuevo/limpiado; la idempotencia del inbox garantiza seguridad.
- **Observabilidad**: el `traceparent` se guarda en `outbox.trace_context` y viaja en los datos del job de pg-boss (no en el envelope); `correlationId` en logs. Métricas `pf.outbox.pending`, `pf.outbox.lag`, `pf.inbox.duplicates`, `pf.events.dead_lettered`, `pf.queue.dead_letter` (docs/18 §5.3).

## 7. PII

- Prohibido en payloads: números de cuenta completos, tokens, emails, nombres reales de terceros salvo `counterparty`/`provider.name` cuando el consumidor lo necesita.
- Texto libre (`description`, `reason`, `name`) marcado como PII baja; los consumidores no lo envían a sistemas externos (LLM/ML) sin pasar por el ACL de redacción.
- Outbox retenido sigue políticas de retención y RLS por `workspace_id`.

## Preguntas abiertas

1. ¿`eventType` incluye la versión (`transactions.TransactionPosted.v1`) o se separa en `eventVersion` (propuesto aquí: separada, nombre completo = concatenación)? Confirmar en ADR-0008.
2. Retención de `outbox` publicados (7 vs 30 días) y si sirve como fuente de replay o sólo las tablas fuente.
3. ¿`TransactionCreated` debe emitirse además de `TransactionPosted` cuando una transacción nace `posted`? Propuesto: sí (dos eventos, semánticas distintas); evaluar ruido.
4. ¿Se necesita un evento de dominio específico para `Reconciliation` en Phase 1 (`ReconciliationCompleted`) o basta con Audit? → **Resuelta (2026-10-08, `add-reconciliation`)**: se publica `transactions.ReconciliationCompleted.v1` (Phase 2) y el hecho dedicado `transactions.TransactionCleared.v1` (D47).
