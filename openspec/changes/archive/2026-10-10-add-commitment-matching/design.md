# Diseño

## Contexto

`add-recurrence-engine` crea COMMITMENTS con definiciones, ocurrencias y la vinculación manual (`LinkOccurrence`, `OccurrenceLinkPort`, `matchedBy`). Este change agrega el **matching sugerido** (FR-COMMITMENTS-010) dentro del mismo contexto y capability (`commitments/recurrence-engine`, docs/01 §9; ARCHITECTURE §14 no prevé una capability aparte): el servicio de dominio `OccurrenceMatcher` de docs/04 §3.7, alimentado por los hechos de Transactions (docs/05 §2.7: "Consumidos: `transactions.TransactionCreated` (auto-match), `TransactionVoided`"; docs/06 relación 13, asíncrona). Sirve a dos consumidores posteriores: el indicador de **pagos sorpresa** (SM-07, exit criteria de Phase 3) y los **imports** de Phase 6 (docs/24 §5.6 depende de "Phase 3 (matching con ocurrencias)"; docs/13). Motivación: proposal.md — Why.

Reglas que se respetan: **nunca vincular sin confirmación** (FR-COMMITMENTS-010 dice "sugerido"; el producto no toma decisiones financieras por el usuario); consumidores idempotentes (INV-028, inbox + clave natural); auditoría de las decisiones del usuario en la misma unidad de trabajo (INV-029); contextos desacoplados (solo `@pf/transactions/contracts`); dinero en `Decimal` (INV-001); fechas de negocio locales (RISK-020).

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Commitments | DS puro `OccurrenceMatcher.candidates(tx, occurrences, tolerances) → MatchCandidate[]` (filtros duros, puntaje, confianza, motivos, ambigüedad); VO `MatchTolerances {amountTolerancePct, dateWindowDays}` con defaults por `AmountSpec` | domain | Nuevo |
| Commitments | AR `MatchSuggestion {id, occurrenceId, transactionId, score, confidence, reasons, ambiguous, status (PROPOSED\|CONFIRMED\|DISMISSED\|EXPIRED), expireReason?, version}` | domain | Nuevo |
| Commitments | Comandos `ConfirmMatchSuggestion` (usa `LinkOccurrence` con `matchedBy = SUGGESTION`), `DismissMatchSuggestion`, `SetMatchingTolerances` (anotación de la definición); consumidores `commitments.occurrence-matcher` y `commitments.match-backfill`; query `ListMatchSuggestions`; contrato `OccurrenceMatchCandidatesQuery` | application | Nuevo |
| Commitments | Ganchos en los comandos de `add-recurrence-engine` que resuelven o cancelan ocurrencias (`MaterializeOccurrence`, `LinkOccurrence`, `SkipOccurrence`, `RevisionPlanner`, pausa, fin, `RELEASE`): expiran las sugerencias propuestas de la ocurrencia en la misma UoW | application | Ampliación |
| Transactions | `TransactionLinkQuery.listLinkCandidates({workspaceId, accountIds, from, to}) → [{transactionId, kind, status, businessDate, amount, accountId, toAccountId, counterpartyId, source, externalRef}]` (no anuladas) | contracts | Ampliación aditiva |
| apps | Controller (`match-suggestions`), worker (dos consumidores), web (contador, tarjetas) | interface | Nuevo |

## Objetivos / No objetivos

**Objetivos:**
- Sugerencias explicables (por qué coincide: diferencia de monto, de días, contraparte) y deterministas (mismo input ⇒ mismo puntaje).
- Cero vinculaciones sin confirmación (propiedad verificada con PBT).
- Idempotencia ante reentregas y ráfagas de imports; descarte permanente por par.
- Que SM-07 (calculado en `reporting/cash-flow-calendar`) vea vinculados los pagos ya registrados: backfill al generar ocurrencias y `matchedBy` en el vínculo.

**No objetivos:**
- Auto-vincular por umbral de confianza; pagos combinados o parciales (N:1, 1:N); detección de recurrencias sin definición; ML; notificaciones por sugerencia (pregunta 6).

## Decisiones

1. **Misma capability, change separado.** FR-COMMITMENTS-010 está en `commitments/recurrence-engine` (docs/01). El delta agrega requirements a esa capability; por eso este change **requiere que `add-recurrence-engine` se archive antes** (la spec base debe existir al archivar). Es Should: puede postergarse sin afectar el motor, salvo el requirement Must "nunca vincula sin confirmación", que es una garantía (si el change no se implementa, se cumple trivialmente).

2. **Filtros duros (`OccurrenceMatcher`).** Una ocurrencia es candidata de una transacción si y solo si: la ocurrencia está `SCHEDULED|DUE|OVERDUE` y no tiene una sugerencia `DISMISSED` con esa transacción; la transacción no está `VOIDED`, no tiene `externalRef.namespace = 'commitments.occurrence'` (la creó una ocurrencia) y no está vinculada a otra ocurrencia; mismo tipo (`EXPENSE`↔`EXPENSE`, `INCOME`↔`INCOME`, `TRANSFER`↔`TRANSFER`; reembolsos, ajustes, conversiones y saldos iniciales nunca); misma cuenta (transferencia: mismo origen y destino) y misma moneda; `|businessDate − dueDate| ≤ dateWindowDays` (defecto 5; 0..15); contraparte: si ambas la tienen, iguales; monto dentro de la tolerancia: `FIXED` `|tx − esperado| ≤ esperado × tol` (defecto 2 %), `ESTIMATED` idem (defecto 25 %), `MIN_MAX` `min × (1 − tol) ≤ tx ≤ max × (1 + tol)` (defecto 5 %), `VARIABLE` cualquier monto > 0 **y** contraparte igual y presente en ambas. Los defaults se pueden sobrescribir por definición (`SetMatchingTolerances`, anotación, columnas `matching_amount_tolerance_pct numeric(5,2)` 0..100 y `matching_date_window_days smallint` 0..15). Defaults en pregunta 1.

3. **Puntaje y confianza (explicable, sin ML).** `score = amountScore + dateScore + counterpartyScore` (0..100, Decimal, 2 decimales HALF_EVEN): `amountScore = 50 × (1 − |Δ| / margen)` (margen = tolerancia en moneda; `Δ = 0` ⇒ 50; para `MIN_MAX` Δ = distancia al rango, 0 dentro; para `VARIABLE` 25 fijo); `dateScore = 30 × (1 − |días| / (ventana + 1))`; `counterpartyScore` = 20 si coinciden, 10 si falta en alguna. Confianza `HIGH` ≥ 80, `MEDIUM` ≥ 60, `LOW` < 60. Ranking por `score` desc, luego `|días|`, luego `dueDate`; `ambiguous = true` en las dos mejores si empatan. Ejemplo del scenario: Internet 199.00 BOB vs gasto 199.00 BOB a 1 día sin contraparte ⇒ 50 + 25 + 10 = 85 (`HIGH`).

4. **Consumidor `commitments.occurrence-matcher`** (cola propia, lotes de 10 + concurrencia 4 de `improve-event-throughput`, `key_strict_fifo` por `transactionId`):
   - `transactions.TransactionCreated.v1` ⇒ evalúa la transacción (los datos vienen en el payload: `kind`, `status`, `businessDate`, `legs[]`, `counterpartyId`, `origin`); busca ocurrencias no resueltas del workspace por `(workspace_id, due_date)` en `[businessDate − 15, businessDate + 15]` y cuenta, y filtra con el matcher.
   - `transactions.TransactionUpdated.v1` con `changedFields ∩ {amount, businessDate, accountId, counterpartyId, splits} ≠ ∅` ⇒ relee la transacción con `TransactionLinkQuery.getForLink` y re-evalúa: recalcula el puntaje de las propuestas que siguen compatibles, expira (`INCOMPATIBLE`) las que no y crea las nuevas.
   - `transactions.TransactionVoided.v1` ⇒ expira (`TRANSACTION_VOIDED`) las propuestas de esa transacción.
   Idempotencia: `platform.inbox (consumer, eventId)` en la transacción del consumidor + `UNIQUE (occurrence_id, transaction_id)` con `INSERT … ON CONFLICT DO NOTHING` (un mismo par nunca se duplica ni revive si está `DISMISSED`, `CONFIRMED` o `EXPIRED`; las expiradas por incompatibilidad sí pueden volver a `PROPOSED` si una edición posterior las hace compatibles — transición `REPROPOSE`, solo desde `EXPIRED{INCOMPATIBLE}`). Cada inserción emite `commitments.OccurrenceMatchSuggested.v1`.

5. **Backfill — consumidor `commitments.match-backfill`** de `commitments.OccurrencesGenerated.v1` (propio): para las ocurrencias del lote con `dueDate − ventana ≤ hoy`, consulta `TransactionLinkQuery.listLinkCandidates` (cuentas de la definición, rango `[dueDate − ventana, dueDate + ventana]`) y aplica el matcher. Cubre "definí el compromiso después de pagarlo" (SM-07) y las reinstauraciones. No hace falta en la generación síncrona (el consumidor corre con lag ≤ 5 s).

6. **Expiración síncrona por resolución.** Los comandos de `add-recurrence-engine` que sacan una ocurrencia de `SCHEDULED|DUE|OVERDUE` (materializar, vincular, omitir, cancelar por pausa/revisión/fin) llaman a `MatchSuggestionRepository.expireForOccurrence(occurrenceId, reason)` en la misma UoW (`OCCURRENCE_RESOLVED` / `OCCURRENCE_CANCELLED`); `RELEASE` (transacción anulada) no revive sugerencias viejas: la anulación ya las expiró. Así la bandeja nunca muestra sugerencias obsoletas, sin depender del orden de eventos.

7. **Confirmar.** `ConfirmMatchSuggestion {suggestionId}` (EDITOR/OWNER, `Idempotency-Key`, `If-Match` opcional): `FOR UPDATE` de la sugerencia; estado ≠ `PROPOSED` ⇒ `MATCH_SUGGESTION_NOT_PENDING` (409); invoca `LinkOccurrence` (mismas validaciones: `OCCURRENCE_ALREADY_MATERIALIZED`, `TRANSACTION_ALREADY_LINKED`, `OCCURRENCE_LINK_MISMATCH` si la transacción cambió entre medio) con `matchedBy = SUGGESTION` y `suggestionId` en `detailRefs` del recorrido; marca `CONFIRMED`; expira (`SUPERSEDED`) las demás propuestas de esa ocurrencia y de esa transacción; auditoría `commitments.match_suggestion.confirmed` + la de la vinculación; evento `RecurringOccurrenceMaterialized.v1 {mode: MATCHED, matchedBy: SUGGESTION}`. Todo en una UoW. **Descartar** (`DismissMatchSuggestion`): `DISMISSED` permanente, auditoría `commitments.match_suggestion.dismissed`, sin evento.

8. **Sin máquina de recorrido para la sugerencia.** La sugerencia es una propuesta, no un elemento financiero; sus decisiones quedan en la auditoría y la vinculación aparece en el recorrido de la ocurrencia (`LINK` con `matchedBy = SUGGESTION`) (pregunta 5).

9. **SM-07 sin duplicar el indicador.** El indicador de pagos sorpresa lo define y calcula `add-upcoming-payments` (`reporting/cash-flow-calendar`, su decisión 10) con `ResolvedOccurrencesQuery.listResolvedOutflows` de `add-recurrence-engine` (ocurrencia resuelta cuyo `generatedAt` local es igual o posterior a la fecha del pago). Este change no agrega otra medida: lo sirve (a) con el backfill (decisión 5), que convierte en vínculo confirmable el caso típico "definí el compromiso después de pagarlo", sin el cual ese pago quedaría fuera de la medida; y (b) con `matchedBy = SUGGESTION` en el vínculo, para que Reporting pueda distinguir sorpresas detectadas por sugerencia. Una confirmación tardía no cambia la medida (depende de cuándo se generó la ocurrencia, no de cuándo se confirmó).

10. **Contrato para Imports (Phase 6).** `OccurrenceMatchCandidatesQuery.findCandidates({workspaceId, rows: [{rowRef, kind, accountId, toAccountId?, amount: MoneyDto, businessDate, counterpartyId?}]}) → [{rowRef, candidates: MatchCandidateDto[]}]` (máx. 500 filas por llamada, una consulta por cuenta y rango): solo lectura, sin persistir, para mostrar "coincide con Internet 20/10" en la vista previa. Tras confirmar el import, las transacciones con `origin = IMPORT` pasan por el consumidor normal. Imports **no** auto-confirma (pregunta 2). El benchmark de D112 (5 000 eventos ≤ 120 s por consumidor) aplica a este consumidor; se agrega un caso de 1 000 transacciones con 12 coincidencias (TC-COMMITMENTS-MATCH-012).

11. **Autorización y auditoría.** Lecturas VIEWER+; confirmar, descartar y cambiar tolerancias EDITOR/OWNER (`INSUFFICIENT_ROLE`). Creación y expiración automáticas no se auditan por fila (son derivados recalculables; el hecho `OccurrenceMatchSuggested.v1` y la tabla dan la traza); las decisiones del usuario sí, en su UoW.

12. **UI.** En `/recurring`, pestaña o filtro "Coincidencias por revisar" con contador; cada tarjeta muestra la ocurrencia, la transacción, el puntaje como confianza (Alta/Media/Baja con texto), los motivos ("mismo monto", "1 día después", "contraparte sin indicar"), la marca "ambigua" y las acciones Confirmar/Descartar. En el detalle de una transacción, si tiene sugerencias propuestas, un aviso "Esto parece el pago de Internet (20/10)" con las mismas acciones. En la definición, campos de tolerancia y ventana con sus valores por omisión visibles.

### Modelo de datos (expand-only)

| Tabla | Columnas principales | Unique / Check / Índices | RLS / grants |
|---|---|---|---|
| `commitments.occurrence_match_suggestion` | `id`, `workspace_id`, `occurrence_id` FK `recurring_occurrence`, `definition_id`, `transaction_id`, `score numeric(5,2)`, `confidence` (`HIGH\|MEDIUM\|LOW`), `amount_delta numeric(38,18)`, `currency`, `date_delta_days smallint`, `counterparty_match` (`MATCH\|UNKNOWN`), `ambiguous bool`, `status` (`PROPOSED\|CONFIRMED\|DISMISSED\|EXPIRED`), `expire_reason` (`TRANSACTION_VOIDED\|OCCURRENCE_RESOLVED\|OCCURRENCE_CANCELLED\|INCOMPATIBLE\|SUPERSEDED`), `source_event_id`, `created_at`, `decided_at`, `decided_by`, `version` | **UNIQUE `(occurrence_id, transaction_id)`**; CHECK `status = 'EXPIRED' ⇔ expire_reason IS NOT NULL`, `score BETWEEN 0 AND 100`; índices `(workspace_id, status, created_at) WHERE status = 'PROPOSED'`, `(workspace_id, transaction_id)` | WS; `pf_app`/`pf_worker` SELECT, INSERT, UPDATE; sin DELETE |
| `commitments.recurring_definition` | + `matching_amount_tolerance_pct numeric(5,2) NULL`, `matching_date_window_days smallint NULL` | CHECK rangos 0..100 y 0..15 | sin cambios |

Registro en `platform.workspace_scoped_table` y sección de portabilidad `occurrence-match-suggestions` (orden 760, remapea `occurrence_id`, `definition_id`, `transaction_id`).

## Contratos

Cambios requeridos (los aplica el change al implementar; este PR de planificación no edita `contracts/`).

**OpenAPI** (aditivo, tag `recurring`):

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `listMatchSuggestions` | `GET W/recurring/match-suggestions?status=PROPOSED&occurrenceId=&transactionId=&definitionId=` | VIEWER | Cursor; `MatchSuggestion {id, occurrence: RecurringOccurrenceSummary, transaction: TransactionSummary, score, confidence, reasons {amountDelta: Money, dateDeltaDays, counterparty}, ambiguous, status, expireReason, createdAt}` |
| `confirmMatchSuggestion` | `POST W/recurring/match-suggestions/{suggestionId}/confirm` | EDITOR | `Idempotency-Key`; 200 `{suggestion, occurrence}`; 409 `MATCH_SUGGESTION_NOT_PENDING`, `OCCURRENCE_ALREADY_MATERIALIZED`, `TRANSACTION_ALREADY_LINKED`; 422 `OCCURRENCE_LINK_MISMATCH` |
| `dismissMatchSuggestion` | `POST W/recurring/match-suggestions/{suggestionId}/dismiss` | EDITOR | `Idempotency-Key`; 409 `MATCH_SUGGESTION_NOT_PENDING` |
| `updateRecurringDefinition` | `PATCH W/recurring/{definitionId}` | EDITOR | Campo nuevo `matching {amountTolerancePercent: string\|null, dateWindowDays: int\|null}` (`null` = default) |

Error nuevo (docs/10 §8, commitments): `MATCH_SUGGESTION_NOT_PENDING` 409.

**Evento** `contracts/events/commitments/OccurrenceMatchSuggested.v1.schema.json` — aggregate `MatchSuggestion`; trigger: sugerencia creada o re-propuesta; payload `suggestionId, occurrenceId, definitionId, transactionId, score (string), confidence, amountDelta: Money, dateDeltaDays, ambiguous, transactionOrigin: MANUAL|IMPORT|…`; idem. natural `(suggestionId, aggregateVersion)`; consumidores: REPORTING (Q9 "requiere tu atención", Phase 7), NOTIFY (si el owner lo pide, pregunta 6); PII N.

**Contratos entre módulos:** `@pf/commitments/contracts` agrega `COMMITMENTS_CONSUMERS.occurrenceMatcher`, `.matchBackfill`, `OccurrenceMatchCandidatesQuery`, `MatchCandidateDto`. `@pf/transactions/contracts`: `TransactionLinkQuery.listLinkCandidates` (aditivo).

## Riesgos / Trade-offs

- [Falsos positivos (dos gastos iguales en la misma cuenta)] → filtros duros estrictos (cuenta, tipo, moneda, contraparte no contradictoria, ventana corta), marca de ambigüedad, confirmación obligatoria y descarte permanente.
- [Falsos negativos (monto con comisión, débito con días de retraso)] → tolerancias configurables por definición y vinculación manual siempre disponible; métrica `commitments_match_suggestions_total{outcome}` (confirmadas/descartadas/expiradas) para calibrar defaults (pregunta 1).
- [Ráfagas de imports (Phase 6)] → consumidor en lotes con concurrencia (D112), consulta indexada por `(workspace_id, due_date)`, sin I/O externo; caso de 1 000 transacciones en TC-COMMITMENTS-MATCH-012.
- [Orden de eventos (Voided antes que Created en reentregas)] → la evaluación de `Created` relee el estado con `getForLink` antes de insertar; una transacción anulada no genera sugerencias.
- [Consistencia eventual (RISK-022)] → la sugerencia llega con lag ≤ 5 s p95; la expiración por resolución es síncrona.

## Plan de migración

Expand-only: `CREATE TABLE commitments.occurrence_match_suggestion` con RLS forzada, política WS y grants; `ALTER TABLE commitments.recurring_definition ADD COLUMN … NULL` (dos columnas, sin default costoso); registro en `platform.workspace_scoped_table`. Sin datos que migrar. Rollback: revertir el despliegue; la tabla puede quedar vacía y las columnas nulas.

**Dependencias con otros changes:**
- Requiere **archivado** `add-recurrence-engine` (capability base, `LinkOccurrence`/`OccurrenceLinkPort`, `matchedBy`, estados, `OccurrencesGenerated.v1`, `TransactionLinkQuery`) y los de Phase 1–2 que este a su vez requiere (`improve-event-throughput` para el consumidor en lotes).
- Lo usan: el change de `commitments/subscriptions` (la confirmación publica `RecurringOccurrenceMaterialized.v1` con el monto real, insumo de la detección de cambio de precio FR-COMMITMENTS-014); el CSV básico de Phase 3 (FR-IMPORTS-003, Could) si se implementa, vía el consumidor normal; Phase 6 `imports/import-pipeline` (`OccurrenceMatchCandidatesQuery`); `add-upcoming-payments` (SM-07, vía los vínculos que este change ayuda a confirmar); Phase 7 Reporting (Q9).

## Cambios a docs compartidos

(No editados en este change; los consolida el lead.)
- **docs/04 §3.7:** AR `MatchSuggestion`; `OccurrenceMatcher` con filtros, puntaje y confianza; comandos `ConfirmMatchSuggestion`, `DismissMatchSuggestion`.
- **docs/05 §2.7:** consumidos `TransactionCreated`, `TransactionUpdated`, `TransactionVoided` y el propio `OccurrencesGenerated` (backfill); publicado `OccurrenceMatchSuggested`.
- **docs/08 §5.7:** tabla `occurrence_match_suggestion` y columnas de tolerancia.
- **docs/10:** recurso `recurring/match-suggestions`; error `MATCH_SUGGESTION_NOT_PENDING`.
- **docs/11 §3.3:** `commitments.OccurrenceMatchSuggested.v1`; consumidores `commitments.occurrence-matcher` y `commitments.match-backfill` en la lista de consumidores de `TransactionCreated/Updated/Voided`.
- **docs/00 §8 (SM-07):** el backfill de sugerencias como parte de la medición (la definición operativa la registra `add-upcoming-payments`).
- **docs/13:** el preview de import usa `OccurrenceMatchCandidatesQuery`; imports no auto-confirma.
- **docs/28:** "Coincidencias por revisar" en `/recurring` y aviso en el detalle de transacción.
- **docs/03 §7:** orden: después de `add-recurrence-engine`.

## Preguntas abiertas

Las marcadas **[B]** bloquean el inicio del grupo indicado.

1. **[B grupo 2] Tolerancias y ventana por omisión.** **Opciones:** (a) `FIXED` ±2 %, `ESTIMATED` ±25 %, `MIN_MAX` ±5 % sobre el rango, ventana ±5 días; (b) tolerancia única ±10 % y ventana ±7 días; (c) solo coincidencia exacta de monto. **Recomendación: (a)** (refleja la incertidumbre de cada tipo; ventana suficiente para débitos con retraso y fines de semana); se recalibra con la métrica de resultados.
2. **[B Phase 6] ¿Auto-confirmar coincidencias de alta confianza en imports?** **Opciones:** (a) nunca; el usuario confirma (en lote desde la revisión del import); (b) auto-confirmar `HIGH` con opt-in por workspace. **Recomendación: (a)** en Phase 3 y 6 (FR-COMMITMENTS-010 dice "sugerido"); la confirmación en lote se diseña con el import.
3. **Mostrar sugerencias de confianza baja.** **Opciones:** (a) mostrar todas con su confianza en texto; (b) ocultar las `LOW` de la bandeja y mostrarlas solo en el detalle de la transacción. **Recomendación: (a)** mientras el volumen sea bajo (Phase 3); revisar con imports (Phase 6).
4. **Pagos combinados o parciales (N:1 y 1:N).** **Opciones:** (a) fuera de Phase 3 (una transacción ↔ una ocurrencia); (b) permitir vincular varias transacciones a una ocurrencia (pago en cuotas) y una transacción a varias ocurrencias. **Recomendación: (a)**; se revisa con tarjetas de crédito (Phase 4), donde el pago parcial es habitual.
5. **Recorrido de ciclo de vida para la sugerencia (D37).** **Opciones:** (a) sin máquina; decisiones en la auditoría y vínculo en el recorrido de la ocurrencia; (b) máquina `MatchSuggestion` con recorrido propio. **Recomendación: (a)** (como D110 para planes).
6. **Notificar sugerencias.** **Opciones:** (a) no; contador en `/recurring` y, en Phase 7, ítem en Q9 "Requiere tu atención"; (b) notificación in-app por sugerencia `HIGH`. **Recomendación: (a)** (evita ruido; el aviso de pago próximo ya existe).
7. **Re-proponer tras una edición.** **Opciones:** (a) una sugerencia expirada por incompatibilidad vuelve a `PROPOSED` si una edición posterior la hace compatible; las descartadas nunca; (b) ninguna expirada vuelve. **Recomendación: (a)**.
