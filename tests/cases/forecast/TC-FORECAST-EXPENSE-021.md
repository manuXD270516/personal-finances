---
id: TC-FORECAST-EXPENSE-021
title: "La misma petición con la misma semilla da los mismos resultados"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronósticos reproducibles"
scenario: "Mismo conjunto procesado dos veces"
requirement_status: provisional
fr: ["FR-FORECAST-002","FR-FORECAST-007"]
nfr: []
invariants: []
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["determinism","python"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se envía dos veces la misma petición con la semilla 42"
expected_result:
  - "las dos respuestas tienen los mismos valores esperados e intervalos en todos los puntos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-021 — La misma petición con la misma semilla da los mismos resultados

## Intención

Verifica el scenario "Mismo conjunto procesado dos veces" del requirement "Pronósticos reproducibles" de `forecast/expense-forecasting` (FR-FORECAST-002, FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se envía dos veces la misma petición con la semilla 42
Entonces las dos respuestas tienen los mismos valores esperados e intervalos en todos los puntos
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
