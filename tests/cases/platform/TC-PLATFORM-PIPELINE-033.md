---
id: TC-PLATFORM-PIPELINE-033
title: "La persistencia de 19 949 ms se publica desglosada en espera inicial, 25 lotes por paso, cierre y observación, con suma dentro de ±5 %"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "El benchmark del import publica el desglose de la persistencia"
scenario: "Desglose de una persistencia de 19 949 ms"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-007"]
invariants: []
priority: high
type: platform
level: unit
automation_status: automated
automated_tests:
  - "packages/contexts/imports/src/application/imports.service.test.ts"
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
input: {"persist_ms":19949,"rows":5000,"batches":25,"batch_size":200,"tolerance_low_ms":18952,"tolerance_high_ms":20946,"persist_budget_ms":20000}
steps:
  - "Publicar la fila del host con el desglose de la persistencia del input"
expected_result:
  - "El reporte publica la espera inicial, los 25 lotes con su duración y la de cada paso, el cierre y la observación final"
  - "La suma de las partes queda entre 18 952 ms y 20 946 ms"
  - "El veredicto de la fila lo decide la persistencia total de 19 949 ms frente a 20 000 ms"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-033 — La persistencia de 19 949 ms se publica desglosada en espera inicial, 25 lotes por paso, cierre y observación, con suma dentro de ±5 %

## Intención

Requirement «El benchmark del import publica el desglose de la persistencia» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando la fila con la configuración del host mide una persistencia de 19 949 ms para 5 000 filas en 25 lotes de 200
Entonces el reporte publica la espera inicial, los 25 lotes con su duración y la de cada paso, el cierre y la observación final
  Y la suma de las partes queda entre 18 952 ms y 20 946 ms
  Y el veredicto de la fila lo decide la persistencia total de 19 949 ms frente a 20 000 ms
```

## Notas

- Cifras del nightly programado 42483000755 (2026-11-08, fila del host). 19 949 × 0,95 = 18 951,55 → 18 952 ms; 19 949 × 1,05 = 20 946,45 → 20 946 ms.
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
