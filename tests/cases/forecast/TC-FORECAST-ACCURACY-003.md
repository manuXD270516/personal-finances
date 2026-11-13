---
id: TC-FORECAST-ACCURACY-003
title: "Los indicadores informan MAE, cobertura, sesgo y periodos"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Indicadores agregados de precisión"
scenario: "Cuatro periodos evaluados"
requirement_status: provisional
fr: ["FR-FORECAST-009","FR-FORECAST-007"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["accuracy","money"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el gasto total a 1 periodo tiene 4 periodos evaluados con esperado menos real de −162.40 BOB, +210.00 BOB, −95.60 BOB y +300.00 BOB, y 3 de ellos dentro del intervalo del 80 %"
expected_result:
  - "los indicadores informan error absoluto medio 192.00 BOB, cobertura del 80 % de 75.00 %, sesgo +63.00 BOB y 4 periodos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-003 — Los indicadores informan MAE, cobertura, sesgo y periodos

## Intención

Verifica el scenario "Cuatro periodos evaluados" del requirement "Indicadores agregados de precisión" de `forecast/expense-forecasting` (FR-FORECAST-009, FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el gasto total a 1 periodo tiene 4 periodos evaluados con esperado menos real de −162.40 BOB, +210.00 BOB, −95.60 BOB y +300.00 BOB, y 3 de ellos dentro del intervalo del 80 %
Entonces los indicadores informan error absoluto medio 192.00 BOB, cobertura del 80 % de 75.00 %, sesgo +63.00 BOB y 4 periodos
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
