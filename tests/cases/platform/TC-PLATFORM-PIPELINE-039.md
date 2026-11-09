---
id: TC-PLATFORM-PIPELINE-039
title: "Con la ráfaga «sin completar» y la fila del host en 21 300 ms el job falla por la fila del host"
spec: platform/delivery-pipeline
related_specs: ["imports/import-pipeline"]
requirement: "Una suite informativa no decide el veredicto aunque su preparación no termine"
scenario: "Fila bloqueante intacta"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-008"]
invariants: []
priority: high
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["nightly", "perf", "imports", "stabilize-import-persist-perf"]
error_code: null
preconditions:
  - "Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)"
  - "Datos ficticios; ningún dato de extractos reales del owner (D255, D281)"
input: {"burst_status":"sin completar","host_persist_ms":21300,"persist_budget_ms":20000}
steps:
  - "Evaluar el veredicto del job con la ráfaga sin completar y la fila del host del input"
expected_result:
  - "El job falla por la fila del host frente a 20 000 ms"
  - "El reporte publica ambas filas por separado"
created: 2026-11-09
updated: 2026-11-09
---

# TC-PLATFORM-PIPELINE-039 — Con la ráfaga «sin completar» y la fila del host en 21 300 ms el job falla por la fila del host

## Intención

Requirement «Una suite informativa no decide el veredicto aunque su preparación no termine» de `platform/delivery-pipeline` (change `stabilize-import-persist-perf`).

## Escenario

```gherkin
Dado Resultado sintético del benchmark del import de 5 000 filas (sin Docker; reporte del harness de rendimiento)
Cuando la suite de la ráfaga queda «sin completar» y la fila del host del import mide una persistencia de 21 300 ms
Entonces el job falla por la fila del host frente a 20 000 ms
  Y el reporte publica ambas filas por separado
```

## Notas

- Garantiza que la regla de la suite informativa no relaja la fila bloqueante (D311).
- El umbral de 20 s de NFR-PERF-007 no cambia (decisión del owner del 2026-11-09).
