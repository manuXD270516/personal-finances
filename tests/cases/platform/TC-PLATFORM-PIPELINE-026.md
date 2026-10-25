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
automation_status: automated
automated_tests:
  - apps/api/test/perf/perf-report.test.ts
  - apps/api/test/perf/background-load.test.ts
  - apps/api/test/perf/isolation.test.ts
status: automated
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
updated: 2026-10-25
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
- Implementado el 2026-10-23 (parte 1 del change, rama `claude/impl-investigate-perf-under-load-a`): `isolationOf` y `applyInterference` de `apps/api/test/perf/perf-report.ts` (unitarios en `perf-report.test.ts`: 12 000 eventos pendientes → veredicto `interferencia` con la cantidad en el mensaje; la medición queda `valid: false`, no se compara con su umbral y cuenta como brecha del job). El cableado de la precondición en cada suite (que la suite falle al empezar) es la tarea 5.1/5.2 del change, después del informe (la purga de D291 la hace posible sin poner en rojo las suites que hoy pasan).
- Parte 2 (2026-10-25, tarea 5.1): `assertIsolated` (`background-load.test.ts`) hace fallar la suite al empezar con el veredicto `interferencia` y la cantidad (12 000 eventos pendientes de un fixture), y también cuando la carga del host no baja de 3,0 en 5 min (veredicto por host con la carga medida, `perf-report.test.ts` e `isolation.test.ts`). El cableado va en `recordSuiteLoad` (`beforeAll` de cada suite `*.perf.ts`). La ejecución real la valida `nightly` (tarea 7.2).
- Nightly programado (run 40186569273 en `main` (programado, 2026-10-25, 10:52–11:51 UTC, commit 72ff10d) en verde: ninguna suite fue marcada `interferencia` (ni por backlog ni por host): la purga y la espera de quietud dejaron la precondición cumplida en cada suite, así que la ruta de fallo solo se ejercita con los fixtures de los tests unitarios.
