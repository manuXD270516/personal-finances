---
id: TC-PLATFORM-PIPELINE-024
title: "La suite de disponible para gastar empieza sin backlog del Large Seed y el reporte publica su carga de fondo"
spec: platform/delivery-pipeline
related_specs: ["reporting/dashboard", "platform/event-delivery"]
requirement: "El benchmark nocturno mide sin interferencia de carga de fondo"
scenario: "Disponible para gastar después del Large Seed"
requirement_status: confirmed
fr: []
nfr: [NFR-PERF-004, NFR-PERF-008]
invariants: []
priority: high
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/perf-report.test.ts
  - apps/api/test/perf/isolation.test.ts
  - apps/api/test/perf/background-load.test.ts
  - apps/api/test/perf/suite-order.test.ts
  - scripts/delivery-policy/test/nightly-policy.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["nightly", "perf", "background-load", "spendable"]
error_code: null
preconditions:
  - "Job perf con el Large Seed cargado y 470 165 eventos pendientes de publicar al terminar la carga"
  - "Purga del backlog residual en la base efímera tras la medición de throughput (D291)"
input:
  pending_after_seed: 470165
  suite: "spendable.perf.ts (40 cuentas, 300 ocurrencias, 20 metas, BOB)"
  threshold_p95_ms: 300
steps:
  - "Test unitario de perf-report: con una foto de carga de fondo sin eventos ni trabajos ajenos, la suite se reporta con su p95 y la tabla de carga"
  - "Corrida de nightly por workflow_dispatch: leer la tabla de carga de fondo de la suite en perf-summary.md"
expected_result:
  - "Al empezar la suite hay 0 eventos pendientes en el outbox y 0 trabajos de colas de eventos de cargas anteriores"
  - "El reporte publica para la suite los eventos pendientes, los trabajos por cola, las conexiones activas y la carga del host"
  - "El p95 se reporta frente a 300 ms como medición válida"
created: 2026-10-21
updated: 2026-10-25
---

# TC-PLATFORM-PIPELINE-024 — La suite de disponible para gastar empieza sin backlog del Large Seed y el reporte publica su carga de fondo

## Intención

S2 de `investigate-perf-under-load`: los p95 de 352,2 ms y 341,1 ms pueden venir del backlog del Large Seed que comparte la base. Un benchmark debe medir solo su propio trabajo y decir con qué carga midió.

## Escenario

```gherkin
Dado el Large Seed cargado con 470 165 eventos pendientes
Cuando corre después la suite de disponible para gastar
Entonces al empezar no queda ningún evento ni trabajo de la carga anterior
  Y el reporte publica la carga de fondo de la suite y su p95 frente a 300 ms
```

## Notas

- Change `investigate-perf-under-load` (D290, docs/46). `provisional` hasta que el owner eligiera el mecanismo de aislamiento (pregunta 1 de docs/47).
- Confirmado (2026-10-23, D291 de [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)): el owner eligió purgar el backlog residual (outbox y colas `events.*`) en la base efímera tras medir el throughput, solo en el harness; `requirement_status` pasa a `confirmed`.
- Datos ficticios del benchmark existente; `FixedClock` en America/La_Paz.
- Parte 1 implementada el 2026-10-23 (rama `claude/impl-investigate-perf-under-load-a`): `apps/api/test/perf/background-load.ts` toma la foto (outbox pendiente, trabajos `events.*` por cola y estado, conexiones, locks no concedidos, `pg_stat_user_tables`, `os.loadavg()`) al empezar y al terminar cada suite y antes de cada benchmark; `perf-report.ts` la agrega como `backgroundLoad` (aditivo) en `perf-results.json` y como sección «Carga de fondo por suite» de `perf-summary.md`, con el orden real de los archivos. Unitarios en `perf-report.test.ts` y `background-load.test.ts`. Sigue `not_automated`: el 0 de eventos pendientes al empezar depende de la purga de D291 (tarea 5.2) y la tabla real de carga la valida `nightly` por `workflow_dispatch` (tarea 7.2).
- Implementado el 2026-10-25 (parte 2, rama `claude/impl-investigate-perf-under-load-b`, tareas 5.1 a 5.3): `apps/api/test/perf/isolation.ts` purga el backlog residual (eventos pendientes del outbox marcados como publicados y trabajos pendientes de las colas `events.*` borrados, con `VACUUM (ANALYZE)` de las tablas afectadas) y espera la quietud del host (carga de 1 min < 3,0, sin consultas activas ajenas, muestreo cada 10 s, tope de 5 min) antes de la foto de inicio de cada suite (`SuiteLoadRecorder.prepare`); la preparación queda en el reporte («purga previa», «espera de quietud»). Orden determinista de los archivos con `PERF_SUITE_ORDER` y un sequencer en `vitest.perf.config.ts`. Automatizado por tests unitarios sin Docker (`isolation.test.ts`, `suite-order.test.ts`, `perf-report.test.ts`, `background-load.test.ts`, política en `nightly-policy.test.ts`). **La ejecución real (0 eventos y 0 trabajos al empezar, p95 de `spendable` con la purga) la valida `nightly` por `workflow_dispatch` (tarea 7.2).**
