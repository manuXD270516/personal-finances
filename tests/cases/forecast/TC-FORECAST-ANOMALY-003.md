---
id: TC-FORECAST-ANOMALY-003
title: "Una categoría con menos de 8 gastos de historia no se evalúa"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su categoría"
scenario: "Historia insuficiente"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
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
  - "\"Regalos\" tiene 5 gastos en los 365 días anteriores"
  - "se registra un gasto de 900.00 BOB en \"Regalos\""
expected_result:
  - "el gasto no se evalúa por categoría"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-003 — Una categoría con menos de 8 gastos de historia no se evalúa

## Intención

Verifica el scenario "Historia insuficiente" del requirement "Gastos atípicos para su categoría" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando "Regalos" tiene 5 gastos en los 365 días anteriores
Y se registra un gasto de 900.00 BOB en "Regalos"
Entonces el gasto no se evalúa por categoría
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
