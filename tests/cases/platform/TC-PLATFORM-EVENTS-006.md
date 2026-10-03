---
id: TC-PLATFORM-EVENTS-006
title: Los eventos de un mismo agregado se procesan en orden aunque se intercalen con otros
spec: platform/event-delivery
related_specs: []
requirement: Orden de entrega por agregado
scenario: Eventos intercalados de varios agregados
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-008
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
- apps/api/test/events/event-delivery.int.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- ordering
- key_strict_fifo
error_code: null
preconditions:
- Consumidor con concurrencia 4
input:
  aggregates: 5
  events_per_aggregate: 10
steps:
- Confirmar 50 eventos intercalados
- Procesarlos con el relay y el consumidor
- Hacer fallar una vez la versión 1 de otro agregado y confirmar su versión 2
expected_result:
- 'Por agregado, las versiones aplicadas son 1..10 en orden creciente y sin huecos'
- La versión 2 del agregado con fallo se aplica después de la versión 1
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-006 — Los eventos de un mismo agregado se procesan en orden aunque se intercalen con otros

## Intención

Los consumidores sensibles al orden (saldos, estados) se corrompen si un evento posterior adelanta a uno anterior del mismo agregado.

## Escenario

```gherkin
Dado 50 eventos de 5 agregados intercalados
Cuando un consumidor los procesa con concurrencia 4
Entonces cada agregado observa las versiones 1 a 10 en orden
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
