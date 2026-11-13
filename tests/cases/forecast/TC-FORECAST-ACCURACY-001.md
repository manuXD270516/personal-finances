---
id: TC-FORECAST-ACCURACY-001
title: "La evaluación registra error, error absoluto e inclusión en el intervalo"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Precisión de los pronósticos frente al real"
scenario: "Error del gasto total de noviembre"
requirement_status: provisional
fr: ["FR-FORECAST-009"]
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
  - "la corrida del 2026-11-01 esperaba para el gasto total de 2026-11 4350.00 BOB con intervalo del 80 % de 3980.00 BOB a 4790.00 BOB y el gasto real de 2026-11 fue 4512.40 BOB"
expected_result:
  - "la evaluación de 2026-11 a 1 periodo hacia adelante registra error +162.40 BOB, error absoluto 162.40 BOB y real dentro del intervalo del 80 %"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-001 — La evaluación registra error, error absoluto e inclusión en el intervalo

## Intención

Verifica el scenario "Error del gasto total de noviembre" del requirement "Precisión de los pronósticos frente al real" de `forecast/expense-forecasting` (FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la corrida del 2026-11-01 esperaba para el gasto total de 2026-11 4350.00 BOB con intervalo del 80 % de 3980.00 BOB a 4790.00 BOB y el gasto real de 2026-11 fue 4512.40 BOB
Entonces la evaluación de 2026-11 a 1 periodo hacia adelante registra error +162.40 BOB, error absoluto 162.40 BOB y real dentro del intervalo del 80 %
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
