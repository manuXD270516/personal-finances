---
id: TC-PLATFORM-EVENTS-018
title: El worker no arranca si la concurrencia sumada excede su pool de conexiones
spec: platform/event-delivery
related_specs: []
requirement: Rendimiento sostenido de los consumidores
scenario: Configuración que excede el pool de conexiones
requirement_status: provisional
fr: []
nfr:
- NFR-REL-008
invariants: []
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
- config
- startup
error_code: null
preconditions:
- DATABASE_POOL_MAX menor que la concurrencia sumada de los consumidores
input:
  events: 'EVENT_CONSUMER_CONCURRENCY alto con pool pequeño'
steps:
- Arrancar el worker
expected_result:
- El arranque falla
- El mensaje indica la concurrencia total y el tamaño del pool
created: 2026-10-09
updated: 2026-10-09
---

# TC-PLATFORM-EVENTS-018 — El worker no arranca si la concurrencia sumada excede su pool de conexiones

## Intención

Change `improve-event-throughput` (docs/33 D112): verificar el requirement "Rendimiento sostenido de los consumidores" de `platform/event-delivery`.

## Notas

- Borrador; pasa a `ready` cuando el owner apruebe el change (tarea 1.2).
