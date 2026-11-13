---
id: TC-FORECAST-EXPENSE-018
title: "Un VIEWER ve la vista de pronósticos con horizonte 3 sin el botón de corrida"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Vista de pronósticos en la aplicación"
scenario: "Horizonte de 3 periodos"
requirement_status: provisional
fr: ["FR-FORECAST-001","FR-FORECAST-002","FR-FORECAST-003"]
nfr: ["NFR-USAB-001"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["ui","rbac"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un VIEWER abre la vista con horizonte 3 el 2026-11-05"
expected_result:
  - "ve el gasto total y las categorías de 2026-11 a 2027-01 con la banda del 80 %, los costos conocidos de cada periodo, el modelo y el instante de generación"
  - "no ve el botón para solicitar una corrida"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-018 — Un VIEWER ve la vista de pronósticos con horizonte 3 sin el botón de corrida

## Intención

Verifica el scenario "Horizonte de 3 periodos" del requirement "Vista de pronósticos en la aplicación" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-002, FR-FORECAST-003, NFR-USAB-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un VIEWER abre la vista con horizonte 3 el 2026-11-05
Entonces ve el gasto total y las categorías de 2026-11 a 2027-01 con la banda del 80 %, los costos conocidos de cada periodo, el modelo y el instante de generación
  Y no ve el botón para solicitar una corrida
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
