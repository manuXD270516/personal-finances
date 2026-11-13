---
id: TC-FORECAST-ACCURACY-004
title: "Un periodo se evalúa recién pasada la gracia"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Evaluación al terminar el periodo con reevaluación acotada"
scenario: "Evaluación tras el periodo de gracia"
requirement_status: provisional
fr: ["FR-FORECAST-009"]
nfr: []
invariants: []
priority: medium
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["accuracy","scheduler"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el periodo 2026-11 termina el 2026-11-30 con 5 días de gracia"
expected_result:
  - "el trabajo del 2026-12-05 no lo evalúa y el del 2026-12-06 lo evalúa"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-004 — Un periodo se evalúa recién pasada la gracia

## Intención

Verifica el scenario "Evaluación tras el periodo de gracia" del requirement "Evaluación al terminar el periodo con reevaluación acotada" de `forecast/expense-forecasting` (FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el periodo 2026-11 termina el 2026-11-30 con 5 días de gracia
Entonces el trabajo del 2026-12-05 no lo evalúa y el del 2026-12-06 lo evalúa
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
