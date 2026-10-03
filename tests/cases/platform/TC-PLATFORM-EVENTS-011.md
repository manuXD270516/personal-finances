---
id: TC-PLATFORM-EVENTS-011
title: El apagado ordenado deja terminar el evento en curso sin perderlo ni duplicarlo
spec: platform/event-delivery
related_specs: []
requirement: Apagado ordenado de la entrega de eventos
scenario: Apagado con un evento en proceso
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-009
invariants:
- INV-028
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
- graceful-shutdown
error_code: null
preconditions:
- Relay y consumidor con un handler que tarda 1 s
input:
  handler_ms: 1000
steps:
- Confirmar un evento y esperar a que el handler empiece
- Detener relay y consumidores
- Confirmar otro evento
- Arrancar de nuevo
expected_result:
- El primer efecto está confirmado al terminar el apagado
- El segundo evento no se procesa tras la señal
- Al reiniciar se procesa el segundo y el primero no se reaplica
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-011 — El apagado ordenado deja terminar el evento en curso sin perderlo ni duplicarlo

## Intención

Los despliegues no deben perder ni duplicar efectos (NFR-REL-009).

## Escenario

```gherkin
Dado un consumidor procesando un evento que tarda 1 s
Cuando el worker recibe la señal de apagado
Entonces el evento termina y se confirma
  Y no se toman eventos nuevos
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
