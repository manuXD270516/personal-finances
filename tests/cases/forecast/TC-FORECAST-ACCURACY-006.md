---
id: TC-FORECAST-ACCURACY-006
title: "Un periodo fuera de la ventana no se reevalúa"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Evaluación al terminar el periodo con reevaluación acotada"
scenario: "Periodo fuera de la ventana"
requirement_status: provisional
fr: ["FR-FORECAST-009"]
nfr: []
invariants: []
priority: low
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["accuracy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el 2027-04-10 ya se evaluaron 2026-12, 2027-01, 2027-02 y 2027-03 y se edita un gasto de 2026-11"
expected_result:
  - "la evaluación de 2026-11 no cambia"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-006 — Un periodo fuera de la ventana no se reevalúa

## Intención

Verifica el scenario "Periodo fuera de la ventana" del requirement "Evaluación al terminar el periodo con reevaluación acotada" de `forecast/expense-forecasting` (FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el 2027-04-10 ya se evaluaron 2026-12, 2027-01, 2027-02 y 2027-03 y se edita un gasto de 2026-11
Entonces la evaluación de 2026-11 no cambia
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
