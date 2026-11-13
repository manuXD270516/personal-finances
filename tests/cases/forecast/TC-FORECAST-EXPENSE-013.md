---
id: TC-FORECAST-EXPENSE-013
title: "Una serie de menos de 12 periodos tiene confianza baja"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Nivel de confianza del pronóstico"
scenario: "Serie corta"
requirement_status: confirmed
fr: ["FR-FORECAST-002","FR-FORECAST-007"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/forecast-composer.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["confidence"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "\"Restaurantes\" tiene 9 periodos y error escalado 0.70"
expected_result:
  - "su confianza es baja"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-013 — Una serie de menos de 12 periodos tiene confianza baja

## Intención

Verifica el scenario "Serie corta" del requirement "Nivel de confianza del pronóstico" de `forecast/expense-forecasting` (FR-FORECAST-002, FR-FORECAST-007).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando "Restaurantes" tiene 9 periodos y error escalado 0.70
Entonces su confianza es baja
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
