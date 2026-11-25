---
id: TC-FORECAST-ANOMALY-010
title: "Un gasto sin tasa para su fecha no se evalúa"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos que se evalúan"
scenario: "Gasto sin tasa"
requirement_status: provisional
fr: ["FR-FORECAST-010","FR-FORECAST-003"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "no hay tasa USDT/BOB para el 2026-11-12"
  - "se registra un gasto de 30.00 USDT el 2026-11-12 y corre el trabajo diario"
expected_result:
  - "el gasto no se evalúa ni queda marcado y la métrica de no evaluados por falta de tasa suma 1"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-010 — Un gasto sin tasa para su fecha no se evalúa

## Intención

Verifica el scenario "Gasto sin tasa" del requirement "Gastos que se evalúan" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando no hay tasa USDT/BOB para el 2026-11-12
Y se registra un gasto de 30.00 USDT el 2026-11-12 y corre el trabajo diario
Entonces el gasto no se evalúa ni queda marcado y la métrica de no evaluados por falta de tasa suma 1
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
