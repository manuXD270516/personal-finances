---
id: TC-PLATFORM-EVENTS-010
title: Las métricas outbox_pending y outbox_lag_seconds reflejan los eventos pendientes
spec: platform/event-delivery
related_specs: []
requirement: Métricas de pendientes y retraso del outbox
scenario: Pendientes y retraso
requirement_status: confirmed
fr: []
nfr:
- NFR-OBS-004
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
- packages/platform/src/events/metrics.test.ts
- apps/api/test/events/event-delivery.int.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- metrics
- observability
error_code: null
preconditions:
- Métricas registradas sobre un Meter de prueba
input:
  pending: 3
  lag_seconds: 42
steps:
- Confirmar 3 eventos
- Leer el backlog 42 s después de su creación
- Publicarlos y volver a leer
expected_result:
- 'pending = 3 y lag >= 42'
- 'Tras publicar: pending = 0 y lag = 0'
- Ningún instrumento usa workspace_id como label
created: 2026-10-03
updated: 2026-10-03
---

# TC-PLATFORM-EVENTS-010 — Las métricas outbox_pending y outbox_lag_seconds reflejan los eventos pendientes

## Intención

Un relay atascado es un fallo silencioso; la alerta de docs/18 depende de estas métricas.

## Escenario

```gherkin
Dado 3 eventos pendientes, el más antiguo de hace 42 s
Cuando se recolectan las métricas
Entonces outbox_pending es 3 y outbox_lag_seconds al menos 42
```

## Notas

- Automatizado en `packages/platform/src/events/metrics.test.ts`, `apps/api/test/events/event-delivery.int.test.ts` (Testcontainers `postgres:18`, pg-boss real).
