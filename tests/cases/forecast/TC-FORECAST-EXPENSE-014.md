---
id: TC-FORECAST-EXPENSE-014
title: "Una serie larga y calibrada tiene confianza alta"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Nivel de confianza del pronóstico"
scenario: "Serie larga y calibrada"
requirement_status: provisional
fr: ["FR-FORECAST-002","FR-FORECAST-007"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["confidence"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el gasto total tiene 30 periodos, error escalado 0.72 y cobertura del 80 % de 0.79"
expected_result:
  - "su confianza es alta"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-014 — Una serie larga y calibrada tiene confianza alta

## Intención

Verifica el scenario "Serie larga y calibrada" del requirement "Nivel de confianza del pronóstico" de `forecast/expense-forecasting` (FR-FORECAST-002, FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el gasto total tiene 30 periodos, error escalado 0.72 y cobertura del 80 % de 0.79
Entonces su confianza es alta
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
