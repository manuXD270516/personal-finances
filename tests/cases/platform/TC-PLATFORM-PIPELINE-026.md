---
id: TC-PLATFORM-PIPELINE-026
title: "Una suite que empieza con 12 000 eventos pendientes ajenos falla por interferencia y no publica su p95 como válido"
spec: platform/delivery-pipeline
related_specs: []
requirement: "El benchmark nocturno mide sin interferencia de carga de fondo"
scenario: "Interferencia que no se pudo eliminar"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-004, NFR-PERF-008]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["nightly", "perf", "background-load"]
error_code: null
preconditions:
  - "Foto de carga de fondo sintética al empezar la suite de disponible para gastar"
input:
  pending_outbox_events: 12000
  pending_event_jobs: 0
steps:
  - "Evaluar la precondición de aislamiento y el resultado de la suite con la foto sintética"
expected_result:
  - "La suite falla con el veredicto interferencia y la cantidad 12 000 en el mensaje"
  - "El reporte marca la medición como no válida y no la compara con el umbral de 300 ms"
  - "El job perf queda en rojo (D285): la interferencia no se oculta"
created: 2026-10-21
updated: 2026-10-21
---

# TC-PLATFORM-PIPELINE-026 — Una suite que empieza con 12 000 eventos pendientes ajenos falla por interferencia y no publica su p95 como válido

## Intención

Si el aislamiento falla, el benchmark no debe publicar un p95 contaminado como si fuera una regresión del producto, ni esconder el problema: falla con la causa a la vista.

## Escenario

```gherkin
Dada una foto de carga con 12 000 eventos pendientes de una carga anterior
Cuando empieza la suite de disponible para gastar
Entonces la suite falla indicando la interferencia y los 12 000 eventos
  Y su p95 no se publica como medición válida
```

## Notas

- Change `investigate-perf-under-load` (D290). Test unitario previsto en `apps/api/test/perf/perf-report.test.ts` (tarea 2.1) y de la precondición (tarea 5.1).
