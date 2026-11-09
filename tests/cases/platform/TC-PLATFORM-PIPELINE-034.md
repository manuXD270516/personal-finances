---
id: TC-PLATFORM-PIPELINE-034
title: "Un lote de 2 400 ms con mediana de 610 ms se marca atípico (más de 1 830 ms) con sus pasos y sus esperas"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import publica el desglose de la persistencia"
scenario: "Lote atípico con sus esperas"
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
input: {"batches":25,"median_batch_ms":610,"batch_17_ms":2400,"outlier_factor":3,"outlier_limit_ms":1830}
steps:
  - "Publicar el desglose con la duración por lote del input y las esperas muestreadas durante el lote 17"
expected_result:
  - "El reporte marca el lote 17 como atípico por superar 1 830 ms"
  - "El reporte publica para el lote 17 la duración de cada paso y las esperas de la base muestreadas mientras corría"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-034 — Un lote de 2 400 ms con mediana de 610 ms se marca atípico (más de 1 830 ms) con sus pasos y sus esperas

## Intención

Requirement «El benchmark del import publica el desglose de la persistencia» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando la mediana de los 25 lotes es 610 ms y el lote 17 tarda 2 400 ms
Entonces el reporte marca el lote 17 como atípico por superar 1 830 ms
  Y el reporte publica para el lote 17 la duración de cada paso y las esperas de la base muestreadas mientras corría
```

## Notas

- 3 × 610 = 1 830 ms < 2 400 ms.
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
