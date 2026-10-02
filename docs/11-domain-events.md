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
- **Relay**: proceso en `worker` lee outbox (orden por `sequence`), publica a BullMQ, marca `published_at`. At-least-once.
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
| `transactions.ConversionRecorded` | **Mantener** (Phase 1) | Lleva `ConversionDetail` (tasas, fees, spread) para FX (observación de tasa) y Reporting (historial de conversiones). |
| `ledger.JournalEntryPosted` | **Mantener** (Phase 1) | Fuente de proyecciones de saldo en Reporting; incluye reversas. |
| `accounts.AccountOpened` / `AccountArchived` | **Mantener** (Phase 1) | Proyecciones (lista de cuentas en dashboard, net worth), réplicas locales futuras. Ledger **no** los necesita (get-or-create). |
| `commitments.RecurringOccurrenceGenerated` | **Reemplazar** por `commitments.OccurrencesGenerated` (batch por definición y ventana) | Un evento por ocurrencia genera ruido (cientos por ventana). El calendario de flujo de caja sólo necesita el lote. `RecurringOccurrenceDue` (uno por ocurrencia) sí es útil para recordatorios. |
| `planning.BudgetThresholdReached` | **Mantener** (Phase 2) | Hecho de negocio para Notify; dedup por (item, umbral, mes). |
| `goals.SavingsContributionRecorded` | **Mantener** (Phase 4) | Reporting/Notify. |
| `goals.GoalReached` | **Mantener** (Phase 4) | Notify. |
| `debt.LoanInstallmentGenerated` | **Reemplazar** por `debt.LoanScheduleGenerated` | El cronograma se genera completo (y se regenera por versión); un evento por cuota es ruido. Recordatorios usan `CardPaymentDue`/`LoanInstallmentDue` (job diario). |
| `debt.LoanPaymentRecorded` | **Mantener** (Phase 4) | Reporting (deuda), Notify. |
| `documents.AttachmentUploaded` | **Mantener** (Phase 6) | Imports (archivo listo), escaneo completado. |
| `imports.ImportCompleted` | **Mantener** (Phase 6) | Notify, Reporting (refrescar), métricas. |
| `planning.MonthClosed` | **Mantener** (Phase 2) | Reporting (congelar series), Forecast (recalcular), Notify. |
| `planning.PeriodReopened` | **Mantener** (Phase 2) | Reporting (invalidar), Audit visible, Forecast. |
| `forecast.ForecastRequested` | **Descartar como evento de integración** | Es un comando/job interno de Forecast (cola BullMQ), no un hecho que interese a otros contextos. |
| `forecast.ForecastGenerated` | **Mantener** (Phase 8) | Notify, Reporting (mostrar). |
| `commitments.SubscriptionPriceChanged` | **Mantener** (Phase 3) | Notify (alerta de aumento), Reporting. |

### 3.2 Phase 1 (con JSON Schema)

#### `transactions.TransactionCreated.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** RULES, COMMITMENTS (auto-match), REPORTING (pendientes).
- **Trigger:** cualquier `Record*` o `ImportTransactions` acepta una transacción (pending o posted).
- **Payload:** `transactionId: uuid`, `kind: TransactionKind`, `status: PENDING|POSTED`, `businessDate: date`, `description: string|null`, `counterpartyId: uuid|null`, `origin: {type: MANUAL|IMPORT|RECURRING|DEBT|GOALS|SYSTEM, refId: uuid|null}`, `legs: [{accountId: uuid, amount: Money(firmado)}]`, `splits: [{splitId, amount: Money, categoryId|null, tagIds: uuid[]}]`.
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
- **Trigger:** `ApplyClassification` cambia la categoría o tags de ≥1 split.
- **Payload:** `transactionId`, `status`, `businessDate`, `appliedBy: USER|RULE|IMPORT`, `ruleId: uuid|null`, `changes: [{splitId, amount: Money, previousCategoryId|null, newCategoryId|null, addedTagIds[], removedTagIds[]}]`.
- **Idem.:** natural `(transactionId, aggregateVersion)`. **Ord.:** por `Transaction`. **PII:** N.

#### `transactions.TransferCompleted.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** GOALS, DEBT, REPORTING.
- **Trigger:** transferencia posteada (creación o pending→posted) o emparejamiento `LinkAsTransfer`.
- **Payload:** `transactionId`, `journalEntryId`, `businessDate`, `fromAccountId`, `toAccountId`, `amount: Money (positivo)`, `fee: Money|null`, `matchedTransactionIds: uuid[]` (vacío si no hubo emparejamiento).
- **Idem.:** natural `(transactionId, journalEntryId)`. **Ord.:** por `Transaction`. **PII:** N.

#### `transactions.ConversionRecorded.v1`
- **Productor:** TRANSACTIONS. **Consumidores:** FX (observación de tasa), REPORTING.
- **Payload:** `transactionId`, `journalEntryId`, `businessDate`, `executedAt`, `source: {accountId, amount: Money}` (bruto), `target: {accountId, amount: Money}` (neto), `quotedRate: Rate|null`, `effectiveRate: Rate`, `referenceRate: {rate: Rate, fxRateId, source}|null`, `fees: [{type: PROVIDER|NETWORK|BANK|TAX|OTHER, amount: Money, paidFromAccountId|null}]`, `spread: {percentage: string, amount: Money}|null`, `provider: {counterpartyId|null, name|null}`. `Rate = {base, quote, value: string}`.
- **Idem.:** natural `(transactionId, journalEntryId)`. **Ord.:** por `Transaction`. **PII:** B (nombre de proveedor/persona P2P).

#### `ledger.JournalEntryPosted.v1`
- **Productor:** LEDGER. **Consumidores:** REPORTING (saldos), GOALS (earmarks vs saldo).
- **Payload:** `journalEntryId`, `entryDate`, `entryType: STANDARD|REVERSAL|OPENING`, `sequence: string` (bigint como string), `sourceRef: {context, type, id, revision}`, `reversesEntryId|null`, `postings: [{postingId, ledgerAccountId, accountId|null, systemAccountCode|null, amount: Money (firmado), splitId|null}]`.
- **Idem.:** natural `journalEntryId`. **Ord.:** por `JournalEntry` (cada asiento es su propio agregado, versión 1); para saldos se usa `sequence`. **PII:** N.

#### `accounts.AccountOpened.v1`
- **Productor:** ACCOUNTS. **Consumidores:** REPORTING, (futuro) réplicas.
- **Payload:** `accountId`, `name`, `type`, `nature: ASSET|LIABILITY`, `currency`, `institutionId|null`, `openedOn: date`, `includeInNetWorth: boolean`.
- **Idem.:** natural `accountId`. **Ord.:** por `Account`. **PII:** B (`name` puede contener datos personales; no se incluye número de cuenta).

#### `accounts.AccountArchived.v1`
- **Productor:** ACCOUNTS. **Consumidores:** REPORTING, COMMITMENTS (pausar definiciones que usan la cuenta), GOALS.
- **Payload:** `accountId`, `archivedOn: date`, `reason: string|null`.
- **Idem.:** `(accountId, aggregateVersion)`. **Ord.:** por `Account`. **PII:** B.

### 3.3 Fases posteriores (schemas se crean al implementar)

| Evento | Productor | Consumidores | Trigger | Payload (resumen) | Idem. natural | PII |
|---|---|---|---|---|---|---|
| `transactions.TransactionUpdated.v1` | TRANSACTIONS | REPORTING, PLANNING, COMMITMENTS | Amend/edición no cubierta por otros eventos | `transactionId, revision, changedFields[], ledgerImpact: bool, before/after` de campos no sensibles | `(transactionId, aggregateVersion)` | B |
| `accounts.AccountReactivated.v1` / `AccountUpdated.v1` | ACCOUNTS | REPORTING | — | `accountId, changedFields` | `(accountId, version)` | B |
| `commitments.OccurrencesGenerated.v1` | COMMITMENTS | REPORTING | Job de ventana | `definitionId, window: DateRange, occurrences: [{occurrenceId, occurrenceDate, dueDate, expectedAmount: Money}]` | `(definitionId, window)` | N |
| `commitments.RecurringOccurrenceDue.v1` | COMMITMENTS | NOTIFY | Ocurrencia pasa a `due` | `occurrenceId, definitionId, dueDate, expectedAmount, name` | `occurrenceId` | B |
| `commitments.RecurringOccurrenceMaterialized.v1` | COMMITMENTS | REPORTING | Confirm/match | `occurrenceId, transactionId, mode: CREATED\|MATCHED` | `occurrenceId` | N |
| `commitments.SubscriptionPriceChanged.v1` | COMMITMENTS | NOTIFY, REPORTING | `ChangeSubscriptionPrice` | `subscriptionId, counterpartyId, previousPrice: Money, newPrice: Money, effectiveFrom, changePercentage: string` | `(subscriptionId, effectiveFrom)` | N |
| `planning.BudgetThresholdReached.v1` | PLANNING | NOTIFY | Actual cruza umbral | `budgetId, budgetItemId, yearMonth, categoryId\|groupId, threshold: string, planned: Money, actual: Money` | `(budgetItemId, threshold, yearMonth)` | N |
| `planning.MonthClosed.v1` | PLANNING | REPORTING, FORECAST, NOTIFY | `CloseMonth` | `periodId, yearMonth, closedAt, closeSummary: {totalsByCurrency[], balances[]}` | `(periodId, closeNo)` | N |
| `planning.PeriodReopened.v1` | PLANNING | REPORTING, FORECAST | `ReopenPeriod` | `periodId, yearMonth, reason, reopenedBy` | `(periodId, reopenNo)` | B |
| `goals.SavingsContributionRecorded.v1` | GOALS | REPORTING, NOTIFY | Aporte/retiro/earmark | `goalId, contributionId, type, amount: Money, transactionId\|null, sourceAccountId\|null, progress: Money, target: Money` | `contributionId` | N |
| `goals.GoalReached.v1` | GOALS | NOTIFY, REPORTING | progress ≥ target | `goalId, target, progress, reachedOn` | `(goalId, aggregateVersion)` | B (nombre meta) |
| `debt.LoanScheduleGenerated.v1` | DEBT | REPORTING (calendario) | Desembolso/recálculo | `loanId, scheduleVersion, installments: [{n, dueDate, principal, interest, fees, insurance, taxes, total}]` | `(loanId, scheduleVersion)` | N |
| `debt.LoanPaymentRecorded.v1` | DEBT | REPORTING, NOTIFY | `RecordLoanPayment` | `loanId, installmentNos[], transactionId, breakdown: {principal, interest, fees, insurance, taxes, total}: Money, remainingPrincipal: Money` | `(loanId, transactionId)` | N |
| `documents.AttachmentUploaded.v1` | DOCUMENTS | IMPORTS, REPORTING | Escaneo OK | `documentId, contentType, sizeBytes, sha256, purpose` (sin filename) | `documentId` | N |
| `imports.ImportCompleted.v1` | IMPORTS | NOTIFY, REPORTING | Commit terminado | `importJobId, accountId, sourceType, stats: {total, imported, duplicates, ignored, errors}, dateRange` | `importJobId` | N |
| `forecast.ForecastGenerated.v1` | FORECAST | NOTIFY, REPORTING | Corrida exitosa | `forecastRunId, scope, horizonMonths, modelName, modelVersion, summary` | `forecastRunId` | N |
| `fx.RateRecorded.v1` | FX | REPORTING | Tasa manual/proveedor/observación | `rateId, base, quote, value, asOf, rateType, source` | `rateId` | N |
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
| `outbox` | `id (=eventId)`, `sequence bigserial`, `workspace_id`, `event_type`, `event_version`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `envelope jsonb`, `created_at`, `published_at null`, `attempts` | Insert en la misma tx del comando. Relay por `sequence`. Retención de publicados N días (replay). |
| `inbox` | `consumer`, `event_id`, `processed_at` · PK `(consumer, event_id)` | Insert en la tx del handler. |
| `dead_letter` | `consumer`, `event_id`, `envelope`, `error`, `attempts`, `first_failed_at`, `last_failed_at`, `status (OPEN\|REPLAYED\|DISCARDED)` | Tras agotar reintentos. Alerta (métrica `events_dead_lettered_total`). |

- **Dead-letter**: el evento problemático no bloquea otros agregados; para el mismo agregado, el consumidor que exige orden **pausa** ese agregado hasta resolución. Operación: comando admin `ReplayDeadLetter(id)` / `DiscardDeadLetter(id, reason)` (auditados).
- **Replay**: proyecciones (Reporting, actuals de Planning) se reconstruyen (a) desde `outbox` retenido, o (b) — preferido — desde las tablas fuente vía `RebuildProjection` (las proyecciones son funciones de los datos). Replay = reprocesar con un `consumer` nuevo/limpiado; la idempotencia del inbox garantiza seguridad.
- **Observabilidad**: `traceparent` se propaga en metadatos del job BullMQ (no en el envelope); `correlationId` en logs.

## 7. PII

- Prohibido en payloads: números de cuenta completos, tokens, emails, nombres reales de terceros salvo `counterparty`/`provider.name` cuando el consumidor lo necesita.
- Texto libre (`description`, `reason`, `name`) marcado como PII baja; los consumidores no lo envían a sistemas externos (LLM/ML) sin pasar por el ACL de redacción.
- Outbox retenido sigue políticas de retención y RLS por `workspace_id`.

## Preguntas abiertas

1. ¿`eventType` incluye la versión (`transactions.TransactionPosted.v1`) o se separa en `eventVersion` (propuesto aquí: separada, nombre completo = concatenación)? Confirmar en ADR-0008.
2. Retención de `outbox` publicados (7 vs 30 días) y si sirve como fuente de replay o sólo las tablas fuente.
3. ¿`TransactionCreated` debe emitirse además de `TransactionPosted` cuando una transacción nace `posted`? Propuesto: sí (dos eventos, semánticas distintas); evaluar ruido.
4. ¿Se necesita un evento de dominio específico para `Reconciliation` en Phase 1 (`ReconciliationCompleted`) o basta con Audit?
