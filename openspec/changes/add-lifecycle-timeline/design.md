# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Decisión del owner D37 (docs/31). Se construye sobre lo existente, sin event sourcing:

- `audit/audit-trail` (`add-audit-trail`): `audit.audit_log` append-only, particionado, escrito en la misma UoW que el cambio (INV-029), historial por entidad (FR-AUDIT-004) y vista por transacción para VIEWER (D28).
- `transactions/transaction-recording`: máquina de estados `pending → posted → cleared → reconciled`, `void`, amend con reversa + `revision+1`, `transaction_journal_link` con la cadena de asientos, `superseded_in_revision` en legs/splits.
- `transactions/transfers` y `transactions/conversions`: kinds `TRANSFER` y `CONVERSION` del mismo agregado; `ConversionDetail` por revisión (D11).
- `accounts/account-management`: `ACTIVE`, `CLOSED`, `ARCHIVED` y reactivación (D4).
- `fx/market-rates`: tasas inmutables con *supersede* (INV-011).
- Outbox de plataforma (D30).

## Objetivos / No objetivos

**Objetivos:** máquinas de estado declaradas y consultables; una fila de transición por cambio de estado, atómica con el cambio; recorrido completo por API; reporte visual; semántica explícita de edición de transferencias.

**No objetivos:** event sourcing (el estado del agregado sigue siendo la fuente de verdad; las transiciones son su bitácora estructurada); máquinas de otras fases; reemplazar `audit.audit_log` (sigue siendo el diff completo; la transición referencia su `audit_log_id`).

## Decisiones

1. **Máquinas declaradas como datos puros en el dominio de cada contexto.** Cada contexto exporta en su módulo `contracts` una definición `LifecycleMachine` (`aggregateType`, `machineVersion`, `states[{code, terminal}]`, `transitions[{code, from[], to, guard, events[]}]`). El agregado valida sus transiciones contra esa misma definición (una sola fuente; un test de arquitectura verifica que todo cambio de `status` pasa por `machine.assertTransition`). AUDIT no conoce las reglas: solo almacena y sirve.
2. **Máquina `Transaction`** (todos los kinds; `machineVersion = 1`):

   | Transición | Origen → destino | Guarda | Eventos |
   |---|---|---|---|
   | `RECORD` | ∅ → `pending` \| `posted` \| `cleared` | datos válidos, cuentas activas (INV-026), idempotencia | `TransactionCreated` (+ `TransactionPosted`, + `TransferCompleted` si `TRANSFER`, + `ConversionRecorded` si `CONVERSION`, cuando nace posteada) |
   | `POST` | `pending` → `posted` | cuentas activas | `TransactionPosted` (+ `TransferCompleted` / `ConversionRecorded`) |
   | `CLEAR` | `posted` → `cleared` | — | `TransactionUpdated` (`transition = CLEAR`) |
   | `UNCLEAR` | `cleared` → `posted` | — | `TransactionUpdated` |
   | `RECONCILE` | `cleared` → `reconciled` | — | `TransactionUpdated` |
   | `UNRECONCILE` | `reconciled` → `cleared` | motivo obligatorio | `TransactionUpdated` |
   | `REVISE` | `posted` \| `cleared` → `posted` | campos financieros cambian; versión esperada; cuentas activas; misma moneda en `TRANSFER` (`TRANSFER_CURRENCY_MISMATCH`) | `TransactionPosted` (`supersedesJournalEntryId`) + `TransactionUpdated` (`ledgerImpact`) + `TransferRevised` si `TRANSFER` (+ `ConversionRecorded` con el detalle nuevo si `CONVERSION`, comportamiento vigente de `add-manual-conversions`) |
   | `VOID` | `pending` \| `posted` \| `cleared` → `void` | motivo; no `reconciled` (D16); cuentas activas para la reversa | `TransactionVoided` |

   La edición de una transacción `pending` (sin asiento) y las ediciones descriptivas son **anotaciones** (no cambian estado ni ledger).
3. **Máquina `Account`**: `OPEN` ∅ → `ACTIVE` (`AccountOpened`, asiento de saldo inicial si ≠ 0); `CLOSE` `ACTIVE` → `CLOSED` (saldo 0, `AccountClosed`); `ARCHIVE` `ACTIVE` \| `CLOSED` → `ARCHIVED` (`AccountArchived`); `REACTIVATE` `ARCHIVED` \| `CLOSED` → `ACTIVE` (nombre libre, `AccountReactivated`). Metadatos = anotaciones (`AccountUpdated`).
4. **Máquina `ExchangeRate`** (manual): `RECORD` ∅ → `RECORDED` (`RateRecorded`); `SUPERSEDE` `RECORDED` → `SUPERSEDED` (al registrar la corrección; enlaza `supersededByRateId`). Los estados de anomalía de tasas de provider (`PENDING_REVIEW`/`ACCEPTED`/`REJECTED`) los declarará `add-market-rate-providers` con el mismo mecanismo (no se toca aquí).
5. **Registro de transición** `audit.lifecycle_transition` escrito por `AuditPort.recordTransition(...)` dentro de la UoW del comando, después de `AuditPort.append` (para referenciar `audit_log_id`) y antes del commit. Campos: `id`, `workspace_id`, `aggregate_type`, `aggregate_id`, `sequence` (monotónica por agregado; `UNIQUE (workspace_id, aggregate_type, aggregate_id, sequence)`, la toma el comando con el bloqueo optimista del agregado), `kind` (`TRANSITION` \| `ANNOTATION`), `transition`, `from_state`, `to_state`, `machine_version`, `revision_from`, `revision_to`, `aggregate_version`, `occurred_at`, `actor_type`, `actor_id`, `actor_process`, `origin`, `reason`, `correlation_id`, `audit_log_id`, `event_ids uuid[]`, `journal_entries jsonb` (`{reversed, reversal, posted}`), `detail_refs jsonb` (p. ej. `conversionDetailId`, `supersededByRateId`), `changed_fields text[]` (anotaciones), `derived boolean`. Sin montos ni texto libre salvo `reason` (los montos se leen de la revisión enlazada; PII baja).
6. **Consistencia.** El invariant checker del ledger (FR-LEDGER-015) suma un chequeo: el `to_state` de la última transición de cada agregado coincide con su `status`. Una divergencia emite métrica/alerta (no corrige en silencio).
7. **Consulta.** `GetLifecycle(aggregateType, aggregateId)` en AUDIT lee transiciones y anotaciones del agregado (RLS), las ordena por `sequence`, calcula `path` (estados visitados) y adjunta la `LifecycleMachine` del contexto dueño (vía su `contracts`). Para montos por revisión, la API compone con la query pública del contexto dueño (`GetTransactionRevision`, `GetConversionDetail`) — AUDIT no hace joins cross-schema. Autorización: la del agregado (VIEWER incluido, D28); un id de otro workspace ⇒ 404 idéntico a inexistente.
8. **Reconstrucción.** Job idempotente `audit.lifecycle-backfill` (worker) por workspace: para agregados sin transiciones, mapea acciones de `audit.audit_log` (`transactions.transaction.created|posted|amended|voided|status_changed`, `accounts.account.opened|closed|archived|reactivated`, `fx.rate.recorded|superseded`) a transiciones con `derived = true`; acciones no mapeables quedan como anotaciones; si el primer registro de auditoría no es una creación, el recorrido lleva `historyComplete = false`. Nunca crea transiciones sin registro de auditoría que las respalde.
9. **Transferencias (docs/31 D37).** `TransferCompleted.v1` se publica solo en `RECORD`/`POST` (primer asiento). `REVISE` de `kind=TRANSFER` publica `transactions.TransferRevised.v1` con `{transactionId, revisionFrom, revisionTo, fromAccountId, toAccountId, amount, fee|null, reversedJournalEntryId, reversalJournalEntryId, journalEntryId}`; idempotencia natural `(transactionId, revisionTo)`. `VOID` sigue con `TransactionVoided.v1`. Se mantiene `TRANSFER_CURRENCY_MISMATCH` (422). **Comisión en otra moneda o desde una tercera cuenta: no en Phase 1** (se registra una conversión o un gasto aparte) — propuesta pendiente de confirmación del owner.
10. **Campo `transition` en eventos.** Opcional y aditivo en los eventos de transacciones y cuentas listados en proposal.md (`enum` de la máquina correspondiente); los consumidores existentes lo ignoran. No requiere `v2`.
11. **UI "Recorrido".** Componente `LifecycleReport` (apps/web) en el detalle de transacción y de cuenta: diagrama SVG generado desde la `LifecycleMachine` con un layout fijo por máquina (estados en columnas según el flujo principal; `void`/`ARCHIVED` a la derecha), nodos visitados y aristas recorridas destacadas y numeradas por orden, estado actual con énfasis, no recorridos atenuados; debajo, línea de tiempo (transición en español, origen → destino, actor, fecha/hora en la TZ del workspace, motivo, chip "derivada", enlaces "ver revisión n" y "ver asientos" —vista técnica—). La línea de tiempo es la alternativa accesible (el SVG lleva `role="img"` + `aria-describedby`). Textos vía i18n (es; en/pt preparados). No se usa ECharts: el diagrama es estático y determinista.

### Modelo de datos

| Tabla | Cambio | RLS / grants |
|---|---|---|
| `audit.lifecycle_transition` | Crear (ver decisión 5). Índices: `UNIQUE (workspace_id, aggregate_type, aggregate_id, sequence)`; `(workspace_id, occurred_at DESC)`. Trigger `platform.forbid_mutation()` `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE`. | WS con RLS forzada; `pf_app`/`pf_worker` SELECT + INSERT; sin UPDATE/DELETE |

Migración `audit_00xx_lifecycle_transition` (expand, no destructiva).

### Eventos

| Evento | Cuándo | Idempotencia |
|---|---|---|
| `transactions.TransferRevised.v1` (nuevo) | `REVISE` de una transferencia | natural `(transactionId, revisionTo)` |
| `transactions.TransferCompleted.v1` (semántica) | Solo primer asiento de la transferencia | natural `transactionId` |
| Eventos de transacciones y cuentas (aditivo) | Sin cambio de momento; agregan `transition` | sin cambio |

Consumidores: REPORTING (`reporting.data-version` suma `TransferRevised.v1`); GOALS/DEBT (Phase 4) consumirán `TransferCompleted` + `TransferRevised` + `TransactionVoided`.

## Contratos

Cambios **exactos** requeridos (los consolida otro proceso; este change no edita `contracts/`):

**`contracts/openapi/finance-api.v1.yaml`**

1. `GET /workspaces/{workspaceId}/transactions/{transactionId}/lifecycle` (`getTransactionLifecycle`), `GET …/accounts/{accountId}/lifecycle` (`getAccountLifecycle`), `GET …/fx/rates/{rateId}/lifecycle` (`getRateLifecycle`): 200 `Lifecycle`; 404 `NOT_FOUND`; rol VIEWER+. `x-openspec-capability: audit/lifecycle-timeline`.
2. `GET /workspaces/{workspaceId}/lifecycle-machines/{aggregateType}` (`getLifecycleMachine`, `aggregateType` enum `[Transaction, Account, ExchangeRate]`): 200 `LifecycleMachine`.
3. Schemas: `LifecycleMachine` `{aggregateType, machineVersion, states[{code, terminal}], transitions[{code, from: string[], to, guard: string, events: string[]}]}`; `LifecycleTransition` `{sequence, kind: TRANSITION, transition, fromState|null, toState, occurredAt, actor{type, id, displayName}, origin, reason|null, revisionFrom|null, revisionTo|null, aggregateVersion, journalEntries{reversed|null, reversal|null, posted|null}, detailRefs{conversionDetailId?, supersededByRateId?}, events: string[], auditLogId, derived}`; `LifecycleAnnotation` `{sequence, kind: ANNOTATION, occurredAt, actor, origin, changedFields: string[], auditLogId, derived}`; `Lifecycle` `{aggregateType, aggregateId, currentState, path: string[], historyComplete: boolean, machine: LifecycleMachine, items: (LifecycleTransition|LifecycleAnnotation)[]}` (discriminador `kind`).

**`contracts/events/transactions/`**: nuevo `TransferRevised.v1.schema.json` (envelope v1, `aggregateType: Transaction`, payload de la decisión 9, `examples[]` con 300.00 → 250.00 BOB); `TransferCompleted.v1.schema.json`: solo la `description` ("se publica una sola vez por transferencia; las ediciones publican TransferRevised"); campo opcional `transition` en los schemas listados en proposal.md.

**docs/10 §9.1**: sin códigos nuevos (`INVALID_STATUS_TRANSITION`, `TRANSFER_CURRENCY_MISMATCH` ya existen).

## Riesgos / Trade-offs

- [Estado del agregado y última transición divergen] → misma UoW; chequeo en el invariant checker (decisión 6); test de arquitectura que obliga a pasar por la máquina.
- [Doble fuente (audit_log y lifecycle_transition)] → roles distintos: `audit_log` es el diff completo; la transición es el paso del flujo y referencia su `audit_log_id`. Ninguna se deriva de la otra en caliente.
- [Reconstrucción incompleta para datos antiguos] → `derived` + `historyComplete = false`; nunca se inventan pasos.
- [Cambio de semántica de `TransferCompleted` sobre un change ya implementado] → en Phase 1 el único consumidor (REPORTING) solo invalida caché; TC-TRANSACTIONS-TRANSFER-009 fija el nuevo contrato.
- [Diagramas ilegibles en móvil] → layout fijo por máquina con orientación vertical bajo 768 px; la línea de tiempo siempre está disponible.

## Plan de migración

Expand-only: crear `audit.lifecycle_transition` con RLS y trigger; desplegar el código que escribe transiciones; ejecutar `audit.lifecycle-backfill` una vez por workspace (idempotente, reanudable). Rollback: revertir el despliegue; la tabla puede quedar (sin lectores).

Dependencias: requiere aplicados `add-audit-trail`, `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`; coordina con `add-market-rate-providers` (tasas de provider) y `add-demo-data` (registro de la tabla para la purga, si se aplica antes).

## Preguntas abiertas

1. **Comisión de transferencia en otra moneda o desde una tercera cuenta** — propuesta: no en Phase 1 (conversión o gasto aparte). Pendiente de confirmación del owner (docs/31 D37).
2. ¿Agregar `transactions.ConversionRevised.v1` por simetría con `TransferRevised`, o mantener la re-emisión de `ConversionRecorded` con el detalle nuevo? Propuesta: `ConversionRevised.v1` en un change posterior cuando exista un consumidor que lo necesite.
3. ¿Recorrido también para categorías/contrapartes (archivar, fusionar) en Phase 1? Propuesta: no; mismo mecanismo en Phase 2.
4. ¿Exportar el recorrido (CSV/PDF) junto con el export del workspace (FR-IDENTITY-010, Phase 2)?
