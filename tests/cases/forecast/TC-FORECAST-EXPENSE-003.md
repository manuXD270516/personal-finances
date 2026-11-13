---
id: TC-FORECAST-EXPENSE-003
title: "Una categoría solo recurrente tiene historia variable cero"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Historia variable sin doble conteo de lo recurrente"
scenario: "Categoría solo recurrente"
requirement_status: provisional
fr: ["FR-FORECAST-003"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["known-future"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "en el periodo 2026-10 el único gasto de \"Vivienda\" fue el \"Alquiler\" de 2500.00 BOB, emparejado con su ocurrencia"
expected_result:
  - "la historia variable de \"Vivienda\" en 2026-10 es 0.00 BOB"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-003 — Una categoría solo recurrente tiene historia variable cero

## Intención

Verifica el scenario "Categoría solo recurrente" del requirement "Historia variable sin doble conteo de lo recurrente" de `forecast/expense-forecasting` (FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando en el periodo 2026-10 el único gasto de "Vivienda" fue el "Alquiler" de 2500.00 BOB, emparejado con su ocurrencia
Entonces la historia variable de "Vivienda" en 2026-10 es 0.00 BOB
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
