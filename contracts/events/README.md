# contracts/events — Contratos de eventos de dominio (JSON Schema)

> **Estado:** Propuesto · **Fecha:** 2026-10-01 (consolidación Phase 1: 2026-10-02) · **Relacionado:** [docs/11-domain-events.md](../../docs/11-domain-events.md) · [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §7 · [docs/09-ledger-design.md](../../docs/09-ledger-design.md) · ADR-0008, ADR-0016

*Published Language* de los eventos de integración entre bounded contexts. Borrador de Phase 0: describe contratos, no implementación.

## Estructura

```
contracts/events/
├─ envelope.v1.schema.json            # envelope + $defs comunes (Money, Decimal, Rate, Uuid, LocalDate, Instant, CurrencyCode)
├─ identity/
│  ├─ WorkspaceCreated.v1.schema.json
│  └─ WorkspaceSettingsChanged.v1.schema.json
├─ accounts/
│  ├─ AccountOpened.v1.schema.json
│  ├─ AccountUpdated.v1.schema.json
│  ├─ AccountClosed.v1.schema.json
│  ├─ AccountReactivated.v1.schema.json
│  └─ AccountArchived.v1.schema.json
├─ classification/
│  └─ CategoryArchived.v1.schema.json
├─ transactions/
│  ├─ TransactionCreated.v1.schema.json   # además define $defs del contexto: TransactionKind, Origin, Leg, Split
│  ├─ TransactionUpdated.v1.schema.json
│  ├─ TransactionPosted.v1.schema.json
│  ├─ TransactionVoided.v1.schema.json
│  ├─ TransactionCategorized.v1.schema.json
│  ├─ TransferCompleted.v1.schema.json
│  ├─ TransferRevised.v1.schema.json    # add-lifecycle-timeline (docs/31 D37)
│  ├─ ConversionRecorded.v1.schema.json
│  ├─ ConversionRevised.v1.schema.json  # docs/31 D48 (simétrico a TransferRevised)
│  ├─ TransactionCleared.v1.schema.json # add-reconciliation (docs/31 D47): CLEAR/UNCLEAR
│  └─ ReconciliationCompleted.v1.schema.json # add-reconciliation: fin de una sesión
├─ planning/
│  ├─ PeriodActivated.v1.schema.json
│  ├─ BudgetCreated.v1.schema.json
│  ├─ BudgetThresholdReached.v1.schema.json  # add-budgets: lo consume NOTIFY (add-alerts, notifications.budget-threshold)
│  ├─ MonthClosed.v1.schema.json         # add-month-closing: cierre aceptado (snapshot versión closeNo)
│  ├─ PeriodReopened.v1.schema.json      # add-month-closing: reapertura por el OWNER con motivo
│  └─ MonthClosePending.v1.schema.json   # add-month-closing: aviso único por periodo (consume NOTIFY)
├─ commitments/                         # add-recurrence-engine (motor de recurrencia)
│  ├─ OccurrencesGenerated.v1.schema.json    # lote por (definición, ventana efectiva insertada); reemplaza a RecurringOccurrenceGenerated
│  ├─ RecurringOccurrenceDue.v1.schema.json  # BECOME_DUE; lo consume NOTIFY (notifications.occurrence-due)
│  ├─ RecurringOccurrenceMaterialized.v1.schema.json  # MATERIALIZE y LINK (CREATED | MATCHED)
│  ├─ RecurringOccurrenceChanged.v1.schema.json       # EDIT, SKIP, RELEASE, MARK_OVERDUE
│  ├─ RecurringDefinitionChanged.v1.schema.json       # CREATE, REVISE, PAUSE, RESUME, END
│  ├─ SubscriptionPriceChanged.v1.schema.json         # add-subscriptions: origin DETECTED | MANUAL | CORRECTION; lo consume NOTIFY (solo DETECTED)
│  ├─ SubscriptionRenewalUpcoming.v1.schema.json      # add-subscriptions: recordatorio de renovación (job commitments.subscription-daily)
│  ├─ SubscriptionTrialEnding.v1.schema.json          # add-subscriptions: recordatorio de fin de trial
│  ├─ SubscriptionCancelled.v1.schema.json            # add-subscriptions: inmediata o programada
│  └─ OccurrenceMatchSuggested.v1.schema.json         # add-commitment-matching: sugerencia de coincidencia creada o re-propuesta (nunca vincula sola)
├─ imports/                             # add-basic-csv-import (importación CSV; nunca eventos por fila, docs/33 D112)
│  ├─ ImportApproved.v1.schema.json      # aprobación o reintento: lo consume el worker (imports.persist)
│  ├─ ImportFileUploaded.v1.schema.json  # add-import-pipeline: importación creada desde un documento; la consume el worker (imports.persist)
│  ├─ ImportPreviewReady.v1.schema.json  # add-import-pipeline: vista previa lista (solo conteos; sin consumidores por ahora)
│  ├─ ImportFailed.v1.schema.json        # add-import-pipeline: PARSE_FAILED con código y etapa, sin texto del archivo (sin consumidores por ahora)
│  ├─ ImportRevertRequested.v1.schema.json  # add-import-pipeline: deshacer solicitado; lo consume el worker (imports.persist)
│  ├─ ImportReverted.v1.schema.json      # add-import-pipeline: deshacer terminado (ROLLED_BACK o PARTIALLY_ROLLED_BACK; solo conteos)
│  └─ ImportCompleted.v1.schema.json     # fin con COMPLETED, COMPLETED_WITH_DIFFERENCE, PARTIALLY_FAILED o COMPLETED_WITH_ERRORS; `status` y `sourceType` son enums abiertos (aditivo, add-import-pipeline)
├─ debt/                                # add-loans (préstamos) y add-credit-cards (tarjetas; los de tarjeta los consume NOTIFY)
│  ├─ LoanDisbursed.v1.schema.json      # desembolso: principal, comisión retenida y transacción
│  ├─ LoanScheduleGenerated.v1.schema.json  # cronograma fijado (v1 INITIAL) con todas sus cuotas
│  ├─ LoanPaymentRecorded.v1.schema.json    # pago con desglose, cuotas imputadas y principal pendiente
│  ├─ LoanPaymentVoided.v1.schema.json      # anulación del último pago (nuevo respecto de docs/11)
│  ├─ LoanPaidOff.v1.schema.json            # principal pendiente en cero: préstamo saldado
│  ├─ LoanRateChanged.v1.schema.json        # add-loan-amortization-advanced: cambio de tasa variable con vigencia
│  ├─ CardStatementIssued.v1.schema.json    # add-credit-cards: estado de cuenta emitido una vez por (cuenta, cierre) con cifras congeladas
│  ├─ CardPaymentDue.v1.schema.json         # add-credit-cards: recordatorio de vencimiento (lo consume NOTIFY)
│  └─ CreditUtilizationThresholdReached.v1.schema.json  # add-credit-cards: umbral de utilización cruzado (lo consume NOTIFY)
├─ goals/                               # add-savings-goals (metas de ahorro)
├─ documents/                           # add-document-attachments (documentos adjuntos)
│  ├─ SavingsContributionRecorded.v1.schema.json  # un hecho por movimiento (aporte, retiro, reversa, reasignación) con avance antes y después
│  ├─ GoalReached.v1.schema.json         # la meta alcanzó su objetivo (cada vez que pasa a ACHIEVED; lo consume NOTIFY)
│  └─ EarmarkExceedsBalance.v1.schema.json  # cuenta sobre-asignada, una vez por episodio (aggregateType Account; lo consume NOTIFY)
├─ fx/
│  ├─ RateRecorded.v1.schema.json
│  ├─ RateFeedStale.v1.schema.json          # add-rate-feed-alerts: episodio de obsolescencia abierto (par sin tasa aceptada por más de N horas)
│  ├─ RateFeedRecovered.v1.schema.json      # add-rate-feed-alerts: llegó una tasa fresca y el episodio se cerró
│  └─ RateAnomalyRetained.v1.schema.json    # add-rate-feed-alerts: muestra de provider retenida como anómala (un hecho por muestra)
└─ ledger/
   └─ JournalEntryPosted.v1.schema.json
```

Ruta: `contracts/events/<context>/<EventName>.v<N>.schema.json` (ARCHITECTURE §6).

## Convenciones

- **Dialecto**: JSON Schema draft 2020-12. `$id` base `https://contracts.pfos.local/events/` (identificador, no resoluble por red: los validadores deben **precargar** todos los schemas, p. ej. `ajv.addSchema()`).
- **Composición**: cada evento declara `type: object` (requisito de Ajv `strictTypes`) y hace `allOf: [{$ref: "../envelope.v1.schema.json"}]` y fija `eventType` (`const`), `eventVersion` (`const`), `aggregateType` (`const`) y `payload` (`$ref: #/$defs/Payload`).
- **Nombre**: `eventType = <context>.<EventName>`; el nombre completo es `<eventType>.v<eventVersion>`, p. ej. `transactions.TransactionPosted.v1`.
- **Dinero**: `$defs/Money` = `{ "amount": "<decimal string>", "currency": "<CurrencyCode>" }`. `amount` cumple `^-?(0|[1-9][0-9]{0,19})([.][0-9]{1,18})?$` (compatible con `NUMERIC(38,18)`). **Nunca** números JSON para montos o tasas. `PositiveMoney` para montos siempre positivos. La escala exacta por moneda (`currency.scale`) se valida en dominio, no en el schema.
- **Signo**: los montos de `legs` y `postings` usan convención contable (débito +, crédito −); el resto de montos son magnitudes positivas salvo indicación.
- **Tasas**: `$defs/Rate = {base, quote, value}` ⇒ *1 base = value quote*; `value` string positivo.
- **Fechas**: `LocalDate` (`YYYY-MM-DD`, fecha de negocio en la TZ del workspace) vs `Instant` (RFC 3339 UTC con `Z`).
- **IDs**: UUID en minúsculas; `eventId` debe ser UUIDv7.
- **Nulos explícitos**: los campos opcionales están presentes con `null` (todos los campos son `required`), lo que hace el contrato explícito y facilita la detección de cambios. Excepciones documentadas: campos agregados de forma aditiva a un evento ya existente (p. ej. `revision`, `convertedSource`, `grossTarget`, `quotedRateDeviation` en `ConversionRecorded`) y los valores nuevos opcionales de `AccountUpdated` (solo viajan los campos de `changedFields` no sensibles).
- **Enums compartidos con el OpenAPI** (docs/31 D18): el OpenAPI manda. `TransactionKind`, `TransactionSource` (`GOAL` singular; el pago de tarjeta es `TRANSFER`), `AccountType`, `AccountLiquidity`, `FxRateType`, `FxRateSource`, `ConversionFeeType` y `CategoryKind` se mantienen idénticos en ambos contratos.
- **Estrictez**: `additionalProperties: false` en envelope y payloads ⇒ el **productor** debe emitir exactamente el contrato. Los **consumidores** NO validan estrictamente (tolerant reader): ignoran campos desconocidos para soportar cambios aditivos.
- **Enums abiertos**: un campo cuyo catálogo puede crecer (p. ej. `status` y `sourceType` de `imports.ImportCompleted`, `format` y `code` de los eventos de IMPORTS) se declara `type: string` con `examples` y su catálogo en la descripción, no como `enum` cerrado: agregar un valor es un cambio aditivo (MINOR) y los consumidores DEBEN (MUST) tolerar valores desconocidos. (El registro de Ajv es `strict`, por eso no se usa `x-extensible-enum` en estos schemas.)
- **Invariantes no expresables** (p. ej. Σ postings por moneda = 0 en `JournalEntryPosted`) se documentan en `description` y se verifican en los tests de contrato del productor.
- **Ejemplos**: cada schema trae `examples` válidos usados por los tests de consumidores.

## Versionado

Resumen de [docs/11-domain-events.md §4](../../docs/11-domain-events.md):
- Aditivo (campo nuevo con `null` permitido, nuevo evento) ⇒ misma versión, actualizar schema + ejemplo.
- Breaking (renombrar/eliminar/cambiar tipo o semántica) ⇒ nuevo archivo `…v<N+1>.schema.json` + publicación dual durante la migración; luego deprecar `vN`.
- El envelope sólo cambia mediante ADR.

## Validación en CI (propuesta)

1. Meta-validación de todos los schemas (draft 2020-12) y validación de sus `examples`.
2. Diff de compatibilidad contra `main` (cambio breaking sin nueva versión ⇒ fallo).
3. Tests de contrato del productor por evento (`[TC-<CTX>-EVENTS-NNN]`), con Ajv (`strict`, `ajv-formats`).
4. Test de cobertura: todo `eventType` emitido en código tiene schema.

## Eventos Phase 3 — Commitments (`add-recurrence-engine`)

| Evento | Productor | Consumidores |
|---|---|---|
| `commitments.OccurrencesGenerated.v1` | COMMITMENTS | REPORTING (calendario, Phase 7), MATCHING |
| `commitments.RecurringOccurrenceDue.v1` | COMMITMENTS | NOTIFY |
| `commitments.RecurringOccurrenceMaterialized.v1` | COMMITMENTS | REPORTING, SUBSCRIPTIONS |
| `commitments.RecurringOccurrenceChanged.v1` | COMMITMENTS | REPORTING, MATCHING |
| `commitments.RecurringDefinitionChanged.v1` | COMMITMENTS | REPORTING, MATCHING |

Notas: el agregado de cada evento es `RecurringDefinition` (`OccurrencesGenerated`, `RecurringDefinitionChanged`) o `RecurringOccurrence` (el resto) y su `version` sube con cada evento del mismo agregado. Los montos esperados (`expected`) usan `{type, amount|null, min|null, max|null}` con decimal positivo como texto; `managedBy` (`USER|SUBSCRIPTION|DEBT`) permite a Subscriptions filtrar sus definiciones. `transactions.TransactionCreated.v1` lleva `origin.refId` = `occurrenceId` cuando `origin.type = RECURRING` (cambio compatible, sin nueva versión).

## Eventos Phase 1

| Evento | Productor | Consumidores |
|---|---|---|
| `identity.WorkspaceCreated.v1` | IDENTITY | CLASSIFICATION, REPORTING, FX (carga del histórico de tasas y preferencias `PARALLEL`) |
| `identity.WorkspaceSettingsChanged.v1` | IDENTITY | REPORTING |
| `accounts.AccountOpened.v1` | ACCOUNTS | REPORTING |
| `accounts.AccountUpdated.v1` | ACCOUNTS | REPORTING |
| `accounts.AccountClosed.v1` | ACCOUNTS | REPORTING, COMMITMENTS |
| `accounts.AccountReactivated.v1` | ACCOUNTS | REPORTING |
| `accounts.AccountArchived.v1` | ACCOUNTS | REPORTING, COMMITMENTS, GOALS |
| `classification.CategoryArchived.v1` | CLASSIFICATION | REPORTING, PLANNING, RULES |
| `transactions.TransactionCreated.v1` | TRANSACTIONS | RULES, COMMITMENTS, REPORTING |
| `transactions.TransactionUpdated.v1` | TRANSACTIONS | REPORTING |
| `transactions.TransactionPosted.v1` | TRANSACTIONS | PLANNING, REPORTING |
| `transactions.TransactionVoided.v1` | TRANSACTIONS | PLANNING, REPORTING, GOALS, DEBT, COMMITMENTS, FX (solo conversiones: marca anulada su observación) |
| `transactions.TransactionCategorized.v1` | TRANSACTIONS | PLANNING, REPORTING |
| `transactions.TransferCompleted.v1` | TRANSACTIONS | GOALS, DEBT, REPORTING |
| `transactions.TransferRevised.v1` | TRANSACTIONS | REPORTING (GOALS, DEBT en Phase 4) |
| `transactions.ConversionRecorded.v1` | TRANSACTIONS | FX (consumidor `fx.user-conversion-observations`: observación `USER_CONVERSION`, D231), REPORTING |
| `transactions.ConversionRevised.v1` | TRANSACTIONS | FX (`fx.user-conversion-observations`: la observación de la revisión nueva reemplaza a la anterior), REPORTING |
| `fx.RateRecorded.v1` | FX | REPORTING |
| `ledger.JournalEntryPosted.v1` | LEDGER | REPORTING, GOALS |

(Varios consumidores pertenecen a fases posteriores; en Phase 1 el consumidor efectivo es REPORTING.)

## Eventos Phase 4 — Goals (`add-savings-goals`)

| Evento | Productor | Consumidores |
|---|---|---|
| `goals.SavingsContributionRecorded.v1` | GOALS | NOTIFY (hitos `GOAL_MILESTONE`), REPORTING, AUDIT |
| `goals.GoalReached.v1` | GOALS | NOTIFY (`GOAL_REACHED`) |
| `goals.EarmarkExceedsBalance.v1` | GOALS | NOTIFY (`GOAL_OVER_ALLOCATED`) |

Notas: el agregado de `SavingsContributionRecorded` y `GoalReached` es `SavingsGoal` (`aggregateId` = `goalId`); el de `EarmarkExceedsBalance` es `Account` (`aggregateId` = `accountId`, un hecho por `episodeId`). Los montos de movimiento van firmados con `Money` (nunca `PositiveMoney`): aporte y entrada de reasignación positivos, retiro y salida negativos, la reversa con el signo opuesto del movimiento que revierte. `percentBefore` y `percentAfter` son porcentajes con 2 decimales y pueden superar 100. `progressComplete = false` indica fondos sin tasa vigente (no se emiten hitos con progreso incompleto). Los payloads no repiten `workspaceId` (viaja en el envelope). Reemplaza el `SavingsContributionRecorded` de docs/11 (aún no publicado).

## Eventos Phase 5 — FX (`add-rate-feed-alerts`)

| Evento | Productor | Consumidores |
|---|---|---|
| `fx.RateFeedStale.v1` | FX (job de providers, actor SYSTEM `fx-provider:<ciclo>`) | Ninguno en Phase 5 (catálogo y trazabilidad); NOTIFY recibe el aviso `FX_RATE_FEED_STALE` por su puerto síncrono `NotificationIntakePort` en la misma unidad de trabajo (D249) |
| `fx.RateFeedRecovered.v1` | FX | Ninguno en Phase 5; aviso `FX_RATE_FEED_RECOVERED` por el puerto |
| `fx.RateAnomalyRetained.v1` | FX | Ninguno en Phase 5; aviso `FX_RATE_ANOMALY_RETAINED` por el puerto, agrupado por par |

Un consumidor futuro tendría su propia justificación de conexiones (presupuesto de conexiones del worker, D249).

## Eventos Phase 6 — Documents (`add-document-attachments`)

| Evento | Productor | Consumidores | Cuándo |
|---|---|---|---|
| `documents.AttachmentUploaded.v1` | DOCUMENTS | ninguno obligatorio (IMPORTS no lo consume) | El documento queda `AVAILABLE` (verificación o restauración de contenido); payload sin nombre original |
| `documents.DocumentRejected.v1` | DOCUMENTS | ninguno obligatorio | El documento queda `REJECTED` (verificación o subida vencida); reemplaza al `DocumentQuarantined` de docs/05 |
