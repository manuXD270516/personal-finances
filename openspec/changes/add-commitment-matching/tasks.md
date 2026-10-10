# Tareas

> Requiere **archivado** `add-recurrence-engine` (la capability `commitments/recurrence-engine` debe existir para aplicar este delta) y, por transitividad, sus dependencias de Phase 1–2 (en especial `improve-event-throughput`). Lo usan el change de `commitments/subscriptions` (monto real confirmado), el CSV básico de Phase 3 si se implementa, Phase 6 (imports) `add-upcoming-payments` (SM-07) y Phase 7 (Q9). No iniciar un grupo con preguntas abiertas **[B]** de design.md sin resolver que lo afecten (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los requirements ADDED de `commitments/recurrence-engine` y las preguntas abiertas 1–7 de design.md; verificar con `openspec validate add-commitment-matching --strict`
- [ ] 1.2 Revisar TC-COMMITMENTS-MATCH-001..016 contra los scenarios (puntajes calculados a mano con la fórmula de design decisión 3, fechas fijas, `FixedClock` en America/La_Paz); pasar a `ready` y `requirement_status: confirmed`; `pnpm traceability:check` sin errores
- [ ] 1.3 Coordinar con el change de `commitments/subscriptions` (uso de `RecurringOccurrenceMaterialized.v1 {matchedBy: SUGGESTION}` para el cambio de precio) y dejar documentado para Phase 6 el contrato `OccurrenceMatchCandidatesQuery`

## 2. DOMAIN (TDD)

- [ ] 2.1 `MatchTolerances` (defaults por tipo de monto, rangos 0..100 % y 0..15 días) y `OccurrenceMatcher` (filtros duros, puntaje, confianza, motivos, ranking y ambigüedad; Decimal, HALF_EVEN a 2 decimales): tests primero de TC-COMMITMENTS-MATCH-001, -002, -003, -004, -009
- [ ] 2.2 `MatchSuggestion` (estados `PROPOSED|CONFIRMED|DISMISSED|EXPIRED`, motivos de expiración, `REPROPOSE` solo desde `EXPIRED{INCOMPATIBLE}`): tests primero de TC-COMMITMENTS-MATCH-007, -010
- [ ] 2.3 PBT: para toda secuencia de hechos de Transactions y de ocurrencias, el matcher nunca cambia el estado de una ocurrencia ni vincula una transacción; un par descartado nunca vuelve a `PROPOSED`: TC-COMMITMENTS-MATCH-005, -014

## 3. APPLICATION

- [ ] 3.1 `ConfirmMatchSuggestion` (reutiliza `LinkOccurrence` con `matchedBy = SUGGESTION`, expira `SUPERSEDED`, auditoría y evento en la UoW), `DismissMatchSuggestion`, `SetMatchingTolerances`: tests de TC-COMMITMENTS-MATCH-006, -007, -008, -015
- [ ] 3.2 Ganchos de expiración síncrona en los comandos de `add-recurrence-engine` que resuelven o cancelan ocurrencias (`OCCURRENCE_RESOLVED`, `OCCURRENCE_CANCELLED`): test de TC-COMMITMENTS-MATCH-007
- [ ] 3.3 Consumidor `commitments.occurrence-matcher` (`TransactionCreated/Updated/Voided.v1`; inbox + `ON CONFLICT`; relectura con `getForLink`): tests de TC-COMMITMENTS-MATCH-001, -010, -011
- [ ] 3.4 Consumidor `commitments.match-backfill` (`OccurrencesGenerated.v1`, `listLinkCandidates`): tests de TC-COMMITMENTS-MATCH-011, -013
- [ ] 3.5 Query `ListMatchSuggestions` y contrato `OccurrenceMatchCandidatesQuery`: tests de TC-COMMITMENTS-MATCH-012

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: `commitments.occurrence_match_suggestion` (RLS, grants, índices) y columnas de tolerancia en `recurring_definition`; `workspace_scoped_table`; sección de portabilidad `occurrence-match-suggestions` (orden 760) y su esquema de export
- [ ] 4.2 Repositorio Kysely (`INSERT … ON CONFLICT (occurrence_id, transaction_id) DO NOTHING`, `expireForOccurrence`, `expireForTransaction`, `FOR UPDATE`) y test de concurrencia (dos entregas del mismo hecho en paralelo): TC-COMMITMENTS-MATCH-001
- [ ] 4.3 Transactions: `TransactionLinkQuery.listLinkCandidates` (aditivo) con test de contrato
- [ ] 4.4 Worker: registro de los dos consumidores (lotes de 10, concurrencia 4, `key_strict_fifo` por transacción), métricas `commitments_match_suggestions_total{outcome}`; benchmark de ráfaga de 1 000 transacciones: TC-COMMITMENTS-MATCH-012
- [ ] 4.5 Schema `contracts/events/commitments/OccurrenceMatchSuggested.v1.schema.json` y test de contrato de eventos: TC-COMMITMENTS-MATCH-016

## 5. API

- [ ] 5.1 OpenAPI aditivo (`match-suggestions`, campo `matching` de la definición, `MATCH_SUGGESTION_NOT_PENDING` en `ErrorCode`); `oasdiff` sin breaking changes
- [ ] 5.2 Controller (roles, `Idempotency-Key`, RFC 9457) y tests de API de TC-COMMITMENTS-MATCH-006, -008, -015

## 6. UI

- [ ] 6.1 `/recurring`: "Coincidencias por revisar" con contador, tarjetas con confianza (texto), motivos, marca de ambigüedad y acciones Confirmar/Descartar; aviso en el detalle de transacción; campos de tolerancia y ventana en la definición; i18n es/en/pt; axe sin violaciones serias
- [ ] 6.2 Tests de componentes (estados, motivos, confirmación con teclado)

## 7. TESTS / E2E

- [ ] 7.1 E2E: registrar a mano el pago del "Internet", ver la sugerencia, confirmarla y verificar que la ocurrencia queda vinculada y sale del comprometido; descartar otra y comprobar que no vuelve (TC-COMMITMENTS-MATCH-001, -006, -008)

## 8. DOCS

- [ ] 8.1 Aplicar la lista "Cambios a docs compartidos" de design.md (docs/00, 03, 04, 05, 08, 10, 11, 13, 28) cuando el lead la consolide
- [ ] 8.2 Actualizar estados de TC-COMMITMENTS-MATCH-*, matriz de trazabilidad, `pnpm traceability:check` y `openspec validate add-commitment-matching --strict`
