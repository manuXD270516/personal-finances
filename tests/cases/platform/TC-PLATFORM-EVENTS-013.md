---
id: TC-PLATFORM-EVENTS-013
title: Tras una caída de la cola el relay publica la cabeza pendiente de cada agregado antes que sus sucesores
spec: platform/event-delivery
related_specs: []
requirement: Orden de entrega por agregado
scenario: Un evento pendiente de publicar retiene a los siguientes del mismo agregado
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-008
- NFR-REL-010
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
- apps/api/test/events/event-delivery.int.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- ordering
- relay
- degradation
error_code: null
preconditions:
- Relay cuya cola rechaza los trabajos
- Consumidor suscrito con inbox
input:
  events: 'v1 y v2 del mismo agregado confirmados juntos (eventId de v2 < eventId de v1) y un evento de otro agregado'
steps:
- Ejecutar varios lotes del relay con la cola caída
- Restaurar la cola y ejecutar un lote
- Drenar el resto de lotes y consumir
expected_result:
- Con la cola caída los tres eventos siguen pendientes
- El primer lote con la cola arriba publica v1 y el evento del otro agregado, pero no v2
- v2 se publica en un lote posterior y el consumidor aplica v1 antes que v2
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-013 — Tras una caída de la cola el relay publica la cabeza pendiente de cada agregado antes que sus sucesores

## Intención

Regresión del PR #8 (CI, TC-PLATFORM-EVENTS-008): pg-boss ordena la cabeza de cada clave por `(created_on, id)`; si dos eventos del mismo agregado se encolan en la misma transacción del relay comparten `created_on` y el desempate por `eventId` (UUIDv7 con bits aleatorios dentro del mismo milisegundo) puede invertirlos. El relay debe publicar solo la cabeza pendiente de cada agregado por lote.

## Escenario

```gherkin
Dado dos eventos v1 y v2 del mismo agregado pendientes tras una caída de la cola
  Y el eventId de v2 ordena antes que el de v1
Cuando la cola vuelve y el relay publica
Entonces v1 se publica en un lote y v2 en uno posterior
  Y el consumidor aplica v1 antes que v2
```

## Notas

- Determinista: no depende del timing; los eventId se eligen para que el desempate por id invierta el orden si ambos se encolan juntos.
