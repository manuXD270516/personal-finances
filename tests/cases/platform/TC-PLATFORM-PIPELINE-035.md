---
id: TC-PLATFORM-PIPELINE-035
title: "Una limpieza automática de la tabla de trabajos y un punto de control durante la persistencia se publican con inicio y duración"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import publica el desglose de la persistencia"
scenario: "Mantenimiento de la base durante la persistencia"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007"]
invariants: []
priority: medium
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
  - "Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)"
  - "Datos ficticios; ningún dato de extractos reales del owner (D255, D281)"
input: {"autovacuum":{"start_offset_ms":4200,"duration_ms":3100},"checkpoint":{"start_offset_ms":11000,"duration_ms":1800}}
steps:
  - "Publicar la fila con muestras que contienen una limpieza automática de la tabla de trabajos de la cola y un punto de control dentro de la ventana"
expected_result:
  - "El reporte publica la limpieza automática y el punto de control con su inicio y su duración dentro de la ventana de la persistencia"
  - "La medición se publica como válida"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-035 — Una limpieza automática de la tabla de trabajos y un punto de control durante la persistencia se publican con inicio y duración

## Intención

Requirement «El benchmark del import publica el desglose de la persistencia» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando durante la persistencia corren una limpieza automática de la tabla de trabajos de la cola y un punto de control
Entonces el reporte publica la limpieza automática y el punto de control con su inicio y su duración dentro de la ventana de la persistencia
  Y la medición se publica como válida
```

## Notas

- Hipótesis H5 del design (estado de la base tras la purga de la suite anterior).
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
