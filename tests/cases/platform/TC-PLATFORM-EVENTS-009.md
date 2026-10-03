---
id: TC-PLATFORM-EVENTS-009
title: La purga elimina solo eventos publicados vencidos y nunca pendientes
spec: platform/event-delivery
related_specs: []
requirement: Purga de eventos publicados y registros de procesamiento vencidos
scenario: Purga respeta pendientes y retención
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-008
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
- apps/api/test/events/event-delivery.int.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- retention
error_code: null
preconditions:
- Eventos publicados hace 8 y 2 días y uno pendiente
input:
  outbox_retention_days: 7
steps:
- Ejecutar purgeDeliveredEvents con retención de 7 días
expected_result:
- Solo se elimina el publicado hace 8 días
- El pendiente y el publicado hace 2 días siguen
- Los registros de inbox vencidos se eliminan
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-009 — La purga elimina solo eventos publicados vencidos y nunca pendientes

## Intención

Sin purga las tablas crecen sin límite; una purga mal acotada perdería eventos aún no publicados.

## Escenario

```gherkin
Dado un evento publicado hace 8 días, uno hace 2 días y uno pendiente
Cuando corre la purga con retención de 7 días
Entonces solo se elimina el publicado hace 8 días
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
