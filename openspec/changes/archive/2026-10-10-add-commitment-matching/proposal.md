# Propuesta: add-commitment-matching

## Why

Con `add-recurrence-engine` el usuario puede marcar una ocurrencia como pagada vinculando a mano la transacción real (FR-COMMITMENTS-008), pero en la práctica muchos compromisos se pagan por fuera del flujo de aprobación: el banco debita la luz, el usuario registra el internet desde el Quick add, o —desde Phase 6— el pago llega en un extracto importado. Sin ayuda, esas ocurrencias quedan "atrasadas" aunque estén pagadas, el total comprometido (Q4) se infla y el usuario termina con dos registros del mismo pago o con ocurrencias sin resolver. FR-COMMITMENTS-010 (Should, Phase 3) pide **matching automático sugerido** entre ocurrencias pendientes y transacciones manuales o importadas por cuenta, monto ± tolerancia, fecha ± ventana y contraparte. Además, el exit criteria de Phase 3 exige "0 pagos recurrentes sorpresa en un mes" (SM-07, docs/00 §8), que se mide comparando ocurrencias con transacciones no planificadas: el matching provee ese cruce. Phase 6 (imports) reutilizará el mismo matcher para sugerir coincidencias de filas importadas (docs/24 §5.6 depende de "Phase 3 (matching con ocurrencias)").

## What Changes

- **Sugerencias de coincidencia** (`OccurrenceMatcher`, servicio de dominio puro de docs/04 §3.7): al registrarse, editarse o importarse una transacción, el consumidor `commitments.occurrence-matcher` de los hechos de Transactions busca ocurrencias no resueltas compatibles (mismo tipo, misma cuenta o par de cuentas, misma moneda, fecha dentro de la ventana, monto dentro de la tolerancia del tipo de monto, contraparte no contradictoria) y guarda sugerencias con puntaje, nivel de confianza y motivos.
- **Nunca vincula solo:** ninguna sugerencia cambia una ocurrencia ni una transacción sin la confirmación explícita de un EDITOR u OWNER, aunque la coincidencia sea exacta (también para transacciones importadas).
- **Confirmar** una sugerencia vincula la ocurrencia con la transacción reutilizando el comando de vinculación de `add-recurrence-engine` (`matchedBy = SUGGESTION`) y expira las demás sugerencias de esa ocurrencia y de esa transacción; **descartar** la marca como descartada para siempre (el mismo par nunca se vuelve a sugerir).
- **Ranking** cuando hay varias ocurrencias candidatas para una transacción (o varias transacciones para una ocurrencia), con marca de ambigüedad.
- **Invalidación**: anular la transacción, resolver la ocurrencia por otra vía (aprobar, vincular a mano, omitir, cancelar) o editar la transacción de forma que deje de ser compatible expira las sugerencias afectadas; al generarse ocurrencias nuevas (por ejemplo, una definición creada después de pagar) se buscan transacciones recientes no vinculadas (*backfill*).
- **Tolerancias por definición** (anotación): tolerancia de monto (%) y ventana de fechas (días), con valores por omisión según el tipo de monto.
- **Insumo de SM-07** (pagos sorpresa): el indicador lo calcula `reporting/cash-flow-calendar` (`add-upcoming-payments`) con las ocurrencias resueltas; este change hace que los pagos ya registrados se vinculen (backfill de sugerencias al crear una definición tarde) y deja `matchedBy` para distinguir vínculos por sugerencia.
- **Contrato para Imports (Phase 6)**: consulta sin persistencia de candidatas para filas de una vista previa de import; las transacciones importadas confirmadas reciben sugerencias por el mismo consumidor, que tolera ráfagas (lotes de `improve-event-throughput`).
- API bajo `W/recurring/match-suggestions`; en la UI, contador "Coincidencias por revisar" en `/recurring`, tarjeta de sugerencia en el detalle de la transacción y de la ocurrencia.
- **Fuera de alcance:** vinculación automática sin confirmación (descartada por FR-COMMITMENTS-010 y por la regla de integridad); matching de una transacción contra varias ocurrencias (pago combinado) o de varias transacciones contra una ocurrencia (pago parcial) (pregunta abierta 4); detección de transacciones recurrentes sin definición (`SubscriptionDetector`, Phase 6+); detección de cambio de precio de suscripciones (FR-COMMITMENTS-014, change de `commitments/subscriptions`, que consume la confirmación); pipeline de import (Phase 6) y CSV básico (FR-IMPORTS-003); notificaciones por sugerencia (pregunta abierta 6); aprendizaje de tolerancias con ML.

## Capabilities

### New Capabilities
- Ninguna. (FR-COMMITMENTS-010 pertenece a `commitments/recurrence-engine` según docs/01 §9 y ARCHITECTURE §14; este change agrega requirements a esa capability, creada por `add-recurrence-engine`.)

### Modified Capabilities
- `commitments/recurrence-engine`: matching sugerido entre ocurrencias y transacciones, confirmación y descarte, invalidación, tolerancias, backfill y candidatas para imports (9 requirements ADDED: 1 Must, 8 Should).

## Impact

**Specs impactadas:** agrega requirements a `commitments/recurrence-engine` (requiere que `add-recurrence-engine` se archive antes). Lee comportamiento de `transactions/transaction-recording` (estados, anulación, edición), `transactions/transfers`, `classification/counterparties`, `audit/lifecycle-timeline` (la vinculación por sugerencia aparece en el recorrido de la ocurrencia con su sugerencia), `platform/event-delivery`.

**Componentes/contextos impactados:** COMMITMENTS: DS `OccurrenceMatcher` (puro), agregado `MatchSuggestion`, comandos `ConfirmMatchSuggestion`, `DismissMatchSuggestion`, `SetMatchingTolerances`; consumidores `commitments.occurrence-matcher` (hechos de Transactions) y `commitments.match-backfill` (`OccurrencesGenerated.v1` propio); query `ListMatchSuggestions`; contrato `OccurrenceMatchCandidatesQuery`. TRANSACTIONS: `TransactionLinkQuery` ampliada con `listLinkCandidates` (transacciones no anuladas por cuenta y rango de fechas, para el backfill). `apps/api` (controller), worker (consumidores), `apps/web` (tarjetas y contador).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo, tag `recurring`): `GET W/recurring/match-suggestions`, `POST W/recurring/match-suggestions/{suggestionId}/confirm|dismiss`, campos `matching {amountTolerancePercent, dateWindowDays}` en `PATCH W/recurring/{definitionId}` y en `RecurringDefinition`; código nuevo `MATCH_SUGGESTION_NOT_PENDING` (409).

**Tablas impactadas:** nueva `commitments.occurrence_match_suggestion`; columnas nuevas nulas `matching_amount_tolerance_pct`, `matching_date_window_days` en `commitments.recurring_definition` (expand); lectura de `txn.transaction` solo vía puerto.

**Eventos impactados:** produce `commitments.OccurrenceMatchSuggested.v1` (nuevo). Consume `transactions.TransactionCreated.v1`, `transactions.TransactionUpdated.v1`, `transactions.TransactionVoided.v1` y `commitments.OccurrencesGenerated.v1`. La confirmación publica `commitments.RecurringOccurrenceMaterialized.v1` (`mode = MATCHED`, `matchedBy = SUGGESTION`) definido por `add-recurrence-engine`.

**Migraciones requeridas:** expand, no destructiva: tabla nueva con RLS forzada por `workspace_id` y grants (`pf_app`/`pf_worker` SELECT, INSERT, UPDATE; sin DELETE), dos columnas nulas en `recurring_definition`, registro en `platform.workspace_scoped_table` y sección de portabilidad.

**Test cases:** AÑADIDOS — TC-COMMITMENTS-MATCH-001..016 (16). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** no cambia comportamiento previo: la vinculación manual de `add-recurrence-engine` sigue igual y la confirmación la reutiliza. Nuevo consumidor de los hechos de Transactions en el worker: con imports (Phase 6) recibirá ráfagas; vigilar `outbox_lag_seconds` (NFR-PERF-008) y el benchmark de D112.

**Riesgos introducidos:** RISK-022 (consistencia eventual: la sugerencia llega con lag; la vinculación manual sigue disponible al instante), riesgo de falsos positivos (sugerencias erróneas) mitigado por confirmación obligatoria, filtros duros y descarte permanente; RISK-005 (sobre-ingeniería del puntaje: reglas fijas y explicables, sin ML).

**Invariantes afectadas:** INV-013 (indirecta: una ocurrencia resuelta referencia una sola transacción), INV-028 (consumidores idempotentes), INV-029 (auditoría de confirmar y descartar en la misma unidad de trabajo). Ninguna escritura en el ledger ni en transacciones.
