---
id: TC-PLATFORM-EVENTS-014
title: Un backlog de 5 000 eventos en 500 agregados se drena en 120 s o menos con orden por agregado
spec: platform/event-delivery
related_specs: []
requirement: Rendimiento sostenido de los consumidores
scenario: Backlog grande drenado a tiempo
requirement_status: provisional
fr: []
nfr:
- NFR-PERF-008
- NFR-REL-008
invariants: []
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
- throughput
- ordering
error_code: null
preconditions:
- Consumidor con handler trivial y configuración por defecto
- 5 000 eventos pendientes, 10 por agregado en 500 agregados
input:
  events: '5 000 eventos, versiones 1..10 por agregado'
steps:
- Arrancar el consumidor
- Esperar a que el inbox tenga 5 000 registros
expected_result:
- Los 5 000 eventos quedan procesados en 120 s o menos
- Para cada agregado se observan las versiones 1 a 10 en orden creciente
created: 2026-10-09
updated: 2026-10-09
---

# TC-PLATFORM-EVENTS-014 — Un backlog de 5 000 eventos en 500 agregados se drena en 120 s o menos con orden por agregado

## Intención

Change `improve-event-throughput` (docs/33 D112): verificar el requirement "Rendimiento sostenido de los consumidores" de `platform/event-delivery`.

## Notas

- Borrador; pasa a `ready` cuando el owner apruebe el change (tarea 1.2).
