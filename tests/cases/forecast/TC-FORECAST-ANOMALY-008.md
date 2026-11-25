---
id: TC-FORECAST-ANOMALY-008
title: "Un gasto en dólares se evalúa en la moneda de reporte con la tasa de su fecha"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos que se evalúan"
scenario: "Gasto en dólares"
requirement_status: provisional
fr: ["FR-FORECAST-010","FR-FORECAST-003"]
nfr: []
invariants: ["INV-001","INV-020"]
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
  - "la tasa USD/BOB del 2026-11-12 es 6.96 y la historia de \"Restaurantes\" es la de TC-FORECAST-ANOMALY-001"
  - "se registra un gasto de 50.00 USD en \"Restaurantes\" el 2026-11-12"
expected_result:
  - "el gasto se evalúa como 348.00 BOB y queda marcado con razón 4.4"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-008 — Un gasto en dólares se evalúa en la moneda de reporte con la tasa de su fecha

## Intención

Verifica el scenario "Gasto en dólares" del requirement "Gastos que se evalúan" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando la tasa USD/BOB del 2026-11-12 es 6.96 y la historia de "Restaurantes" es la de TC-FORECAST-ANOMALY-001
Y se registra un gasto de 50.00 USD en "Restaurantes" el 2026-11-12
Entonces el gasto se evalúa como 348.00 BOB y queda marcado con razón 4.4
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
