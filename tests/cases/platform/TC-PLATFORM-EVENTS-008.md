---
id: TC-PLATFORM-EVENTS-008
title: Con la cola caída el comando se confirma y el evento se publica cuando la cola vuelve
spec: platform/event-delivery
related_specs: []
requirement: Escrituras aceptadas con la cola no disponible
scenario: Cola caída durante un comando
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-010
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
- degradation
error_code: null
preconditions:
- Relay cuya cola rechaza los trabajos
input:
  event: identity.WorkspaceCreated v1
steps:
- Confirmar un comando que registra el evento
- Ejecutar el relay con la cola caída
- Restaurar la cola y ejecutar el relay
expected_result:
- El comando se confirma
- outbox_pending refleja el evento y la fila registra el intento fallido
- Al volver la cola el evento se publica y se aplica sin intervención
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-008 — Con la cola caída el comando se confirma y el evento se publica cuando la cola vuelve

## Intención

El core debe seguir registrando aunque la mensajería falle (NFR-REL-010); el outbox absorbe la indisponibilidad.

## Escenario

```gherkin
Dado que la cola no acepta trabajos
Cuando el OWNER crea el workspace "Hogar"
Entonces el comando se confirma
  Y el evento queda pendiente hasta que la cola vuelve
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
