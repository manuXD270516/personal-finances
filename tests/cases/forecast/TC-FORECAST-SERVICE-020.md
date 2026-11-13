---
id: TC-FORECAST-SERVICE-020
title: "Con mucho gasto sin categoría las series por categoría quedan insuficientes"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Calidad de la clasificación para las series por categoría"
scenario: "Historia con mucho gasto sin categoría"
requirement_status: provisional
fr: ["FR-FORECAST-005"]
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
tags: ["readiness"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "en 3 de 8 periodos el gasto sin categoría supera el 10 % del gasto del periodo"
expected_result:
  - "las series por categoría y por grupo quedan con datos insuficientes por clasificación incompleta"
  - "el gasto total se pronostica"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-020 — Con mucho gasto sin categoría las series por categoría quedan insuficientes

## Intención

Verifica el scenario "Historia con mucho gasto sin categoría" del requirement "Calidad de la clasificación para las series por categoría" de `forecast/expense-forecasting` (FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando en 3 de 8 periodos el gasto sin categoría supera el 10 % del gasto del periodo
Entonces las series por categoría y por grupo quedan con datos insuficientes por clasificación incompleta
  Y el gasto total se pronostica
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
