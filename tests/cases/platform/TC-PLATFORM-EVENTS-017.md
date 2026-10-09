---
id: TC-PLATFORM-EVENTS-017
title: Métricas de backlog y duración por consumidor
spec: platform/event-delivery
related_specs: []
requirement: Métricas de pendientes y retraso del outbox
scenario: Pendientes y duración por consumidor
requirement_status: provisional
fr: []
nfr:
- NFR-OBS-004
invariants: []
priority: medium
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
- metrics
- observability
error_code: null
preconditions:
- Consumidor planning.budget-thresholds detenido
input:
  events: '7 eventos publicados sin procesar'
steps:
- Leer event_consumer_backlog
- Arrancar el consumidor y drenar
- Leer las métricas otra vez
expected_result:
- 'event_consumer_backlog{consumer="planning.budget-thresholds"} reporta 7 y luego 0'
- event_consumer_duration_seconds registra 7 observaciones para ese consumidor
created: 2026-10-09
updated: 2026-10-09
---

# TC-PLATFORM-EVENTS-017 — Métricas de backlog y duración por consumidor

## Intención

Change `improve-event-throughput` (docs/33 D112): verificar el requirement "Métricas de pendientes y retraso del outbox" de `platform/event-delivery`.

## Notas

- Borrador; pasa a `ready` cuando el owner apruebe el change (tarea 1.2).
