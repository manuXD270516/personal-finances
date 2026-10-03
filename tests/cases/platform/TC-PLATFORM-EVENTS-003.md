---
id: TC-PLATFORM-EVENTS-003
title: Un evento fuera de contrato o sin schema publicado hace fallar el comando sin efectos
spec: platform/event-delivery
related_specs: []
requirement: Envelope y payload validados contra el contrato al escribir
scenario: Payload fuera de contrato
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-008
- NFR-OBS-002
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
- packages/platform/src/events/outbox-writer.test.ts
- apps/api/test/events/event-delivery.int.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- contract
- json-schema
error_code: null
preconditions:
- Registro de schemas cargado desde contracts/events
input:
  invalid_payload: identity.WorkspaceCreated v1 sin baseCurrency
  unknown_type: identity.WorkspaceRenamed v1
steps:
- Registrar cada evento dentro de una unidad de trabajo que también escribe un efecto
expected_result:
- El registro lanza EventContractError
- 'La transacción se revierte: ni efecto ni evento'
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-003 — Un evento fuera de contrato o sin schema publicado hace fallar el comando sin efectos

## Intención

El productor debe emitir exactamente el contrato (additionalProperties false); un evento inválido detectado tarde rompe consumidores.

## Escenario

```gherkin
Dado un comando que registra "identity.WorkspaceCreated" v1 sin "baseCurrency"
Cuando intenta confirmar
Entonces el comando falla
  Y ni el cambio de estado ni el evento se persisten
```

## Notas

- Automatizado en `packages/platform/src/events/outbox-writer.test.ts`, `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
