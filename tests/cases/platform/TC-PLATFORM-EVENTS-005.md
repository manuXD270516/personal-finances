---
id: TC-PLATFORM-EVENTS-005
title: Cinco entregas del mismo evento producen un único efecto y cuatro duplicados descartados
spec: platform/event-delivery
related_specs: []
requirement: Consumidores idempotentes por evento
scenario: Entrega duplicada
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-007
invariants:
- INV-028
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
- inbox
- idempotency
error_code: null
preconditions:
- Consumidor de proyección registrado
input:
  deliveries: 5
steps:
- Entregar el mismo envelope 5 veces en paralelo
- Entregar un evento cuyo efecto falla una vez y luego reintentarlo
expected_result:
- La proyección tiene 1 efecto
- El contador de duplicados del consumidor suma 4
- El efecto fallido no deja fila en platform.inbox y el reintento lo aplica
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-005 — Cinco entregas del mismo evento producen un único efecto y cuatro duplicados descartados

## Intención

At-least-once implica duplicados; sin inbox en la misma transacción que el efecto se duplicarían saldos y proyecciones (INV-028).

## Escenario

```gherkin
Dado un consumidor de proyección
Cuando el mismo evento llega 5 veces
Entonces el efecto se aplica una sola vez
  Y se cuentan 4 duplicados descartados
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
