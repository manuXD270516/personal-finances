---
id: TC-PLATFORM-EVENTS-001
title: Un comando confirmado deja exactamente un evento pendiente con el envelope completo
spec: platform/event-delivery
related_specs: []
requirement: Evento registrado en la misma transacción que el cambio de estado
scenario: Comando confirmado deja su evento pendiente
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
- transaction
error_code: null
preconditions:
- Unidad de trabajo con contexto RLS de un workspace W
input:
  event: identity.WorkspaceSettingsChanged v1
  aggregateVersion: 2
steps:
- Ejecutar un comando que escribe un efecto y registra el evento
- Confirmar la transacción
- Leer platform.outbox como pf_worker
expected_result:
- Hay una fila pendiente (published_at nulo) con eventId UUIDv7
- 'El envelope cumple envelope.v1 e incluye workspaceId, correlationId de la petición y actor'
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-001 — Un comando confirmado deja exactamente un evento pendiente con el envelope completo

## Intención

Sin escritura atómica estado+evento hay dual write: un evento perdido deja proyecciones y auditoría inconsistentes (ADR-0008).

## Escenario

```gherkin
Dado un comando que cambia el estado del workspace W
Cuando registra "identity.WorkspaceSettingsChanged" v1 y confirma
Entonces existe un evento pendiente con versión de agregado 2
  Y el envelope lleva workspaceId, correlationId y actor
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
