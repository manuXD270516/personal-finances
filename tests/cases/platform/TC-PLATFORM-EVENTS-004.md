---
id: TC-PLATFORM-EVENTS-004
title: 'Si el relay cae tras encolar y antes de marcar, ningún evento se pierde y el efecto es único'
spec: platform/event-delivery
related_specs: []
requirement: Publicación al menos una vez sin pérdida ante caídas
scenario: El publicador cae después de encolar y antes de marcar
requirement_status: confirmed
fr: []
nfr:
- NFR-REL-008
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
- outbox
- relay
- chaos
error_code: null
preconditions:
- 10 eventos pendientes de 10 agregados
- Consumidor suscrito con inbox
input:
  events: 10
steps:
- Ejecutar un lote del relay que falla después de encolar y antes de marcar
- Verificar pendientes
- Arrancar el relay normal y el consumidor
expected_result:
- Tras la caída los 10 eventos siguen pendientes y no hay jobs encolados
- 'Tras reiniciar, cada evento se aplica exactamente una vez'
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-004 — Si el relay cae tras encolar y antes de marcar, ningún evento se pierde y el efecto es único

## Intención

Protege NFR-REL-008: 0 eventos perdidos ante caída del relay (SPIKE-05 escenario a).

## Escenario

```gherkin
Dado 10 eventos pendientes
Cuando el relay los encola y cae antes de marcarlos
Entonces los 10 siguen pendientes
  Y tras reiniciar cada uno se aplica exactamente una vez
```

## Notas

- Automatizado en `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
