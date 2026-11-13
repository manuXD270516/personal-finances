---
id: TC-FORECAST-EXPENSE-010
title: "Se publica el modelo que mejora al menos 5 % a la referencia"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Publicación solo si el modelo supera al de referencia"
scenario: "El suavizado exponencial supera a la referencia"
requirement_status: provisional
fr: ["FR-FORECAST-007"]
nfr: []
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["backtesting","python"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "en el backtesting de \"Supermercado\" el suavizado exponencial obtiene 0.78 y el mejor de referencia 0.90"
expected_result:
  - "se publica el suavizado exponencial para \"Supermercado\""
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-EXPENSE-010 — Se publica el modelo que mejora al menos 5 % a la referencia

## Intención

Verifica el scenario "El suavizado exponencial supera a la referencia" del requirement "Publicación solo si el modelo supera al de referencia" de `forecast/expense-forecasting` (FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando en el backtesting de "Supermercado" el suavizado exponencial obtiene 0.78 y el mejor de referencia 0.90
Entonces se publica el suavizado exponencial para "Supermercado"
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
