---
id: TC-PLATFORM-EVENTS-002
title: Un comando revertido no deja evento ni llega a ningún consumidor
spec: platform/event-delivery
related_specs: []
requirement: Evento registrado en la misma transacción que el cambio de estado
scenario: Comando revertido no deja evento
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-008
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
- apps/api/test/events/event-delivery.int.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- outbox
- rollback
error_code: null
preconditions:
- Relay y un consumidor suscrito en marcha
input:
  event: identity.WorkspaceSettingsChanged v1
steps:
- Registrar el evento dentro de la unidad de trabajo
- Lanzar un error antes del COMMIT
- Esperar un ciclo del relay
expected_result:
- El efecto no existe
- No hay fila en platform.outbox con ese eventId
- El consumidor no recibió el evento
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-002 — Un comando revertido no deja evento ni llega a ningún consumidor

## Intención

Publicar eventos de transacciones revertidas contamina consumidores con hechos que nunca ocurrieron.

## Escenario

```gherkin
Dado un comando que registra un evento
Cuando el comando falla antes de confirmar
Entonces ni el cambio de estado ni el evento existen
  Y ningún consumidor lo recibe
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
