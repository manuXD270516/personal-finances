---
id: TC-PLATFORM-EVENTS-012
title: El consumidor procesa el evento aislado en su workspace y con el correlationId de origen
spec: platform/event-delivery
related_specs: []
requirement: Contexto de tenant y correlación propagados al consumidor
scenario: Consumidor aislado y correlacionado
requirement_status: confirmed
fr: []
nfr:
- NFR-OBS-002
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
- rls
- correlation
error_code: null
preconditions:
- Filas de una tabla con RLS en W1 y W2
input:
  workspace: W1
  correlationId: C
steps:
- Confirmar un evento de W1 con correlationId C
- El consumidor lee la tabla con RLS y su correlación
expected_result:
- El consumidor solo ve filas de W1
- El correlationId activo en el handler es C
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-012 — El consumidor procesa el evento aislado en su workspace y con el correlationId de origen

## Intención

Un consumidor sin contexto de workspace fallaría (PF002) o, peor, mezclaría datos de tenants; la correlación permite seguir una operación de punta a punta.

## Escenario

```gherkin
Dado un evento de "W1 Personal Demo" con correlationId C
Cuando un consumidor lo procesa
Entonces solo ve datos de W1
  Y sus logs llevan el correlationId C
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
