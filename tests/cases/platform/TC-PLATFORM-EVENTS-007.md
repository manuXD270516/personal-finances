---
id: TC-PLATFORM-EVENTS-007
title: Un evento que siempre falla agota sus reintentos y queda en dead-letter sin bloquear otros agregados
spec: platform/event-delivery
related_specs: []
requirement: Reintentos con backoff y dead-letter observable
scenario: Evento venenoso agota sus reintentos
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-012
- NFR-OBS-004
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
- retry
- dead-letter
error_code: null
preconditions:
- Consumidor con 2 reintentos y retardo base 1 s
input:
  poison_aggregate: A
  healthy_aggregate: B
steps:
- Confirmar un evento venenoso de A y un evento de B
- Esperar al dead-letter
expected_result:
- El handler se invoca 3 veces para el evento de A con espera creciente
- platform.dead_letter tiene la fila OPEN con el error y 3 intentos
- La métrica de dead-letters suma 1
- El evento de B se aplica
- La versión 2 del agregado A se publica pero el consumidor no la procesa mientras el dead-letter siga abierto
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-007 — Un evento que siempre falla agota sus reintentos y queda en dead-letter sin bloquear otros agregados

## Intención

Un error permanente no debe reintentarse para siempre ni pasar desapercibido (NFR-REL-012: DLQ visible y alertada).

## Escenario

```gherkin
Dado un consumidor con 2 reintentos
Cuando falla siempre con un evento del agregado A
Entonces lo intenta 3 veces y lo deja en dead-letter abierto
  Y los eventos del agregado B se procesan
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
