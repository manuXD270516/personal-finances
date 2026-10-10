# Tareas

> Requiere **archivado** `add-recurrence-engine` (la capability `commitments/recurrence-engine` debe existir para aplicar este delta) y, por transitividad, sus dependencias de Phase 1–2 (en especial `improve-event-throughput`). Lo usan el change de `commitments/subscriptions` (monto real confirmado), el CSV básico de Phase 3 si se implementa, Phase 6 (imports) `add-upcoming-payments` (SM-07) y Phase 7 (Q9). No iniciar un grupo con preguntas abiertas **[B]** de design.md sin resolver que lo afecten (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner los requirements ADDED de `commitments/recurrence-engine` y las preguntas abiertas 1–7 de design.md; verificar con `openspec validate add-commitment-matching --strict` _(2026-10-10: requirements y preguntas 1–7 revisados con las decisiones del owner D120–D136 de docs/35; `openspec validate --strict` en verde)_
- [x] 1.2 Revisar TC-COMMITMENTS-MATCH-001..016 contra los scenarios (puntajes calculados a mano con la fórmula de design decisión 3, fechas fijas, `FixedClock` en America/La_Paz); pasar a `ready` y `requirement_status: confirmed`; `pnpm traceability:check` sin errores _(2026-10-10: 16 TC `automated` y `confirmed`; puntajes verificados contra la fórmula de la decisión 3)_
- [x] 1.3 Coordinar con el change de `commitments/subscriptions` (uso de `RecurringOccurrenceMaterialized.v1 {matchedBy: SUGGESTION}` para el cambio de precio) y dejar documentado para Phase 6 el contrato `OccurrenceMatchCandidatesQuery` _(2026-10-10: test que confirma una sugerencia de un cargo de suscripción y compara la detección de cambio de precio con la del vínculo manual; contrato `OccurrenceMatchCandidatesQuery` en `@pf/commitments/contracts` y en docs/13 §8.3)_

## 2. DOMAIN (TDD)

- [x] 2.1 `MatchTolerances` (defaults por tipo de monto, rangos 0..100 % y 0..15 días) y `OccurrenceMatcher` (filtros duros, puntaje, confianza, motivos, ranking y ambigüedad; Decimal, HALF_EVEN a 2 decimales): tests primero de TC-COMMITMENTS-MATCH-001, -002, -003, -004, -009
- [x] 2.2 `MatchSuggestion` (estados `PROPOSED|CONFIRMED|DISMISSED|EXPIRED`, motivos de expiración, `REPROPOSE` solo desde `EXPIRED{INCOMPATIBLE}`): tests primero de TC-COMMITMENTS-MATCH-007, -010
- [x] 2.3 PBT: para toda secuencia de hechos de Transactions y de ocurrencias, el matcher nunca cambia el estado de una ocurrencia ni vincula una transacción; un par descartado nunca vuelve a `PROPOSED`: TC-COMMITMENTS-MATCH-005, -014

## 3. APPLICATION

- [x] 3.1 `ConfirmMatchSuggestion` (reutiliza `LinkOccurrence` con `matchedBy = SUGGESTION`, expira `SUPERSEDED`, auditoría y evento en la UoW), `DismissMatchSuggestion`, `SetMatchingTolerances`: tests de TC-COMMITMENTS-MATCH-006, -007, -008, -015
- [x] 3.2 Ganchos de expiración síncrona en los comandos de `add-recurrence-engine` que resuelven o cancelan ocurrencias (`OCCURRENCE_RESOLVED`, `OCCURRENCE_CANCELLED`): test de TC-COMMITMENTS-MATCH-007
- [x] 3.3 Consumidor `commitments.occurrence-matcher` (`TransactionCreated/Updated/Voided.v1`; inbox + `ON CONFLICT`; relectura con `getForLink`): tests de TC-COMMITMENTS-MATCH-001, -010, -011
- [x] 3.4 Consumidor `commitments.match-backfill` (`OccurrencesGenerated.v1`, `listLinkCandidates`): tests de TC-COMMITMENTS-MATCH-011, -013
- [x] 3.5 Query `ListMatchSuggestions` y contrato `OccurrenceMatchCandidatesQuery`: tests de TC-COMMITMENTS-MATCH-012

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand: `commitments.occurrence_match_suggestion` (RLS, grants, índices) y columnas de tolerancia en `recurring_definition`; `workspace_scoped_table`; sección de portabilidad `occurrence-match-suggestions` (orden 760) y su esquema de export _(2026-10-10: migración `20261010300000_commitments_match_suggestions.sql`; orden de purga 169; sección de portabilidad en el orden 765 porque 760–764 ya son de suscripciones)_
- [x] 4.2 Repositorio Kysely (`INSERT … ON CONFLICT (occurrence_id, transaction_id) DO NOTHING`, `expireForOccurrence`, `expireForTransaction`, `FOR UPDATE`) y test de concurrencia (dos entregas del mismo hecho en paralelo): TC-COMMITMENTS-MATCH-001
- [x] 4.3 Transactions: `TransactionLinkQuery.listLinkCandidates` (aditivo) con test de contrato
- [x] 4.4 Worker: registro de los dos consumidores (lotes de 10, concurrencia 4, `key_strict_fifo` por transacción), métricas `commitments_match_suggestions_total{outcome}`; benchmark de ráfaga de 1 000 transacciones: TC-COMMITMENTS-MATCH-012 _(2026-10-10: ambos consumidores usan la concurrencia y el lote por omisión del runtime, así que respetan el presupuesto de conexiones del worker (D112); la ráfaga de 1 000 transacciones está en la suite `perf` (`apps/api/test/perf/commitments.perf.ts`, ~230 eventos/s) y un test de integración verifica que el worker arranca con el pool de cada plantilla)_
- [x] 4.5 Schema `contracts/events/commitments/OccurrenceMatchSuggested.v1.schema.json` y test de contrato de eventos: TC-COMMITMENTS-MATCH-016

## 5. API

- [x] 5.1 OpenAPI aditivo (`match-suggestions`, campo `matching` de la definición, `MATCH_SUGGESTION_NOT_PENDING` en `ErrorCode`); `oasdiff` sin breaking changes
- [x] 5.2 Controller (roles, `Idempotency-Key`, RFC 9457) y tests de API de TC-COMMITMENTS-MATCH-006, -008, -015

## 6. UI

- [x] 6.1 `/recurring`: "Coincidencias por revisar" con contador, tarjetas con confianza (texto), motivos, marca de ambigüedad y acciones Confirmar/Descartar; aviso en el detalle de transacción; campos de tolerancia y ventana en la definición; i18n es/en/pt; axe sin violaciones serias
- [x] 6.2 Tests de componentes (estados, motivos, confirmación con teclado)

## 7. TESTS / E2E

- [x] 7.1 E2E: registrar a mano el pago del "Internet", ver la sugerencia, confirmarla y verificar que la ocurrencia queda vinculada y sale del comprometido; descartar otra y comprobar que no vuelve (TC-COMMITMENTS-MATCH-001, -006, -008) _(2026-10-10: `tests/e2e/specs/commitment-matching.spec.ts`)_

## 8. DOCS

- [x] 8.1 Aplicar la lista "Cambios a docs compartidos" de design.md (docs/00, 03, 04, 05, 08, 10, 11, 13, 28) cuando el lead la consolide
- [x] 8.2 Actualizar estados de TC-COMMITMENTS-MATCH-*, matriz de trazabilidad, `pnpm traceability:check` y `openspec validate add-commitment-matching --strict`

## Notas de implementación (2026-10-10)

Todas las tareas quedaron marcadas; estas son las desviaciones y decisiones propias respecto de design.md (el lead las revisa):

- **Backfill (decisión 5):** el consumidor `commitments.match-backfill` escucha también `commitments.RecurringDefinitionChanged.v1` (`reinstatedOccurrenceIds` y `rewrittenOccurrenceIds`), porque `OccurrencesGenerated.v1` solo anuncia las filas **insertadas**: reanudar una definición reinstaura ocurrencias sin anunciarlas (TC-COMMITMENTS-MATCH-013) y una revisión reescribe otras. La reconciliación del backfill es simétrica a la de la transacción (crea, recalcula, re-propone y expira por incompatibilidad); solo corre para ocurrencias cuya ventana ya empezó (`dueDate − ventana ≤ hoy`).
- **Portabilidad:** la sección `occurrence-match-suggestions` usa el orden **765** (el design decía 760, que ya ocupan las suscripciones); el orden de purga de la tabla es 169 (antes de las ocurrencias, 170).
- **Presupuesto de conexiones (D112):** `occurrence-matcher` y `match-backfill` no fijan `concurrency` ni `batchSize`: usan `EVENT_CONSUMER_CONCURRENCY` / `EVENT_CONSUMER_BATCH_SIZE` (1 en el host de 2 GB, 4 en desarrollo). Con la plantilla del host (`DATABASE_POOL_MAX=20`) el total queda exacto: Σ concurrencia 16 + 4 reservadas = 20, sin margen; el próximo consumidor nuevo obliga a subir el pool de la plantilla (lo verifica un test de integración en `event-throughput.int.test.ts`).
- **Forma de los motivos:** `dateDeltaDays` y `amountDelta` son **absolutos** (TC-001 y TC-016 esperan `1` y `0.00` para un gasto un día antes del vencimiento); `amountDelta` es `null` para una ocurrencia `VARIABLE` (el esquema del evento y `MatchSuggestion.reasons.amountDelta` admiten `null`).
- **Expiración síncrona (decisión 6):** además de materializar, vincular, omitir y cancelar (pausa, fin, revisión), vincular a mano una transacción expira (`SUPERSEDED`) las demás propuestas de esa transacción con otras ocurrencias; al confirmar una sugerencia las demás de la ocurrencia y de la transacción expiran `SUPERSEDED` (al vincular a mano, las de la ocurrencia expiran `OCCURRENCE_RESOLVED`). Recalcular el puntaje de una propuesta vigente tras una edición compatible no publica `OccurrenceMatchSuggested.v1`; solo la creación y la re-propuesta.
- **API:** el tag del OpenAPI es `Commitments` (el design decía `recurring`); la lista agrega `proposedCount` (el contador de la pestaña) y `confirm`/`dismiss` aceptan `If-Match` opcional (la UI lo envía). Editar las tolerancias de una definición **administrada** (suscripción) sigue respondiendo `RECURRING_MANAGED_EXTERNALLY`: una suscripción conserva los valores por omisión (un alza de precio mayor que ±2 % de un monto `FIXED` no se sugiere; el vínculo manual sigue disponible).
- **Alcance no incluido:** editar el monto o el vencimiento de UNA ocurrencia (`PATCH …/occurrences/{id}`) no reevalúa sus sugerencias (sí lo hace una revisión de la definición, vía `rewrittenOccurrenceIds`); cambiar las tolerancias de una definición tampoco reevalúa las sugerencias existentes (aplican a las evaluaciones siguientes).
- **`TransactionLinkQuery.listLinkCandidates`:** devuelve transacciones no anuladas de ingreso, gasto y transferencia por cuenta de origen y rango de fechas.
- **UI:** pestaña "Coincidencias por revisar" con contador en `/recurring`, aviso en los detalles de la transacción y de la ocurrencia, y campos de tolerancia y ventana en la edición de la definición; i18n es/en/pt. Sin contador propio en la sidebar (D135: solo la pestaña).
- **Tiempos:** los PBT y los tests que recorren muchos datos llevan `timeout` explícito (60–600 s) por la lentitud de CI.
