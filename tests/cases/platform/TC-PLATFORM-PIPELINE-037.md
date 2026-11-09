---
id: TC-PLATFORM-PIPELINE-037
title: "Con una calibración de 54 ms frente a 54 ms se publica el factor 1,00 y ningún veredicto cambia"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "Huella del runner publicada en el reporte de rendimiento"
scenario: "Runner de referencia"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007","NFR-MAINT-005"]
invariants: []
priority: low
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
input: {"cpu_calibration_ms":54,"cpu_reference_ms":54,"expected_factor":"1.00"}
steps:
  - "Publicar la huella del runner del input junto a las filas del job"
expected_result:
  - "El reporte publica el factor de CPU 1,00"
  - "Ninguna fila cambia su veredicto por la huella"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-037 — Con una calibración de 54 ms frente a 54 ms se publica el factor 1,00 y ningún veredicto cambia

## Intención

Requirement «Huella del runner publicada en el reporte de rendimiento» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando la calibración de CPU tarda 54 ms frente a una referencia de 54 ms
Entonces el reporte publica el factor de CPU 1,00
  Y ninguna fila cambia su veredicto por la huella
```

## Notas

- Referencia inicial: mediana de las corridas rápidas del design (2026-10-30 a 2026-11-03 y 2026-11-08).
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
