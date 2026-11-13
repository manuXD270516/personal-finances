---
id: TC-PLATFORM-PIPELINE-042
title: "Con 12 201 eventos pendientes de la configuración anterior la fila del host no empieza a medir hasta que la base queda en reposo"
spec: platform/delivery-pipeline
related_specs: ["platform/event-delivery"]
requirement: "Cada configuración del benchmark del import parte de una base en reposo"
scenario: "Backlog de la configuración anterior"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007", "NFR-PERF-008"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "apps/api/test/perf/persist-breakdown.test.ts"
  - "apps/api/test/perf/imports.perf.ts"
status: automated
regression_suite: false
phase: 6
tags: ["nightly", "perf", "imports", "stabilize-import-persist-perf"]
error_code: null
preconditions:
  - "Resultado sintético de la preparación del benchmark del import (sin Docker; lógica pura del harness de rendimiento)"
  - "Datos ficticios; ningún dato de extractos reales del owner (D255, D281)"
input: {"leftover_outbox_pending":12201,"leftover_open_event_jobs":400,"configuration":"host"}
steps:
  - "Detener el worker de la configuración del código con 12 201 eventos pendientes en el outbox"
  - "Purgar el backlog, vaciar y analizar las tablas afectadas y esperar el reposo antes de arrancar el worker del host"
expected_result:
  - "El benchmark no empieza a medir la configuración del host hasta que el outbox y las colas de eventos están en 0"
  - "Una base que no baja a 0 dentro del tope se publica sin reposo con los motivos y la fila bloqueante falla en vez de medir"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-PIPELINE-042 — Con 12 201 eventos pendientes de la configuración anterior la fila del host no empieza a medir hasta que la base queda en reposo

## Intención

Requirement «Cada configuración del benchmark del import parte de una base en reposo» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético de la preparación del benchmark del import (sin Docker; lógica pura del harness de rendimiento)
Cuando la configuración del código termina con 12 201 eventos pendientes en el outbox y se prepara la configuración del host
Entonces el benchmark purga ese backlog con el worker detenido, vacía y analiza las tablas afectadas y no empieza a medir hasta que el outbox y las colas de eventos están en 0
  Y la persistencia del host no incluye la espera por el drenado de la configuración anterior
```

## Notas

- Causa medida en los nightlies del 2026-11-10 y 2026-11-11: la configuración del código persistía en 13,5 s y 19,4 s, pero su drenado no terminaba en 180 s (12 201 y 12 801 eventos pendientes); la fila del host midió 251 s y 577 s, de los cuales 244 s y 556 s eran la espera inicial: `ImportApproved` quedaba detrás de ese backlog en el outbox (el relay publica por orden de secuencia).
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
