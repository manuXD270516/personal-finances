---
id: TC-PLATFORM-PIPELINE-036
title: "Con una calibración de 123 ms frente a 54 ms se publica el factor 2,28 y la fila del host de 32 723 ms falla sin repetirse ni invalidarse"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "Huella del runner publicada en el reporte de rendimiento"
scenario: "Runner más lento que la referencia"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007","NFR-MAINT-005"]
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
input: {"cpu_calibration_ms":123,"cpu_reference_ms":54,"expected_factor":"2.28","host_persist_ms":32723,"persist_budget_ms":20000}
steps:
  - "Publicar la huella del runner del input junto a la fila del host"
expected_result:
  - "El reporte publica la huella con el factor de CPU 2,28 junto a la fila del import"
  - "La fila del host se publica como fallida frente a 20 000 ms, sin repetirse ni invalidarse"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-036 — Con una calibración de 123 ms frente a 54 ms se publica el factor 2,28 y la fila del host de 32 723 ms falla sin repetirse ni invalidarse

## Intención

Requirement «Huella del runner publicada en el reporte de rendimiento» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando la calibración de CPU tarda 123 ms frente a una referencia de 54 ms y la fila del host mide una persistencia de 32 723 ms
Entonces el reporte publica la huella con el factor de CPU 2,28 junto a la fila del import
  Y la fila del host se publica como fallida frente a 20 000 ms, sin repetirse ni invalidarse
```

## Notas

- Cifras del nightly programado 41844086904 (2026-11-04; mediana de la evaluación de reglas 123 ms). 123 / 54 = 2,277… → 2,28.
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
