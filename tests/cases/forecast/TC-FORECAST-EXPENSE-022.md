---
id: TC-FORECAST-EXPENSE-022
title: "Un periodo atípico se señala sin cambiar la historia mostrada"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Periodos atípicos señalados"
scenario: "Mes de viaje"
requirement_status: confirmed
fr: ["FR-FORECAST-003"]
nfr: []
invariants: []
priority: low
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/forecast-composer.test.ts
  - services/ml-forecasting/tests/test_phase8.py
status: automated
regression_suite: false
phase: 8
tags: ["outliers","python"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la historia variable de \"Viajes y ocio\" tiene 2026-07 con 4800.00 BOB y los demás periodos entre 300.00 BOB y 500.00 BOB"
expected_result:
  - "los motivos señalan 2026-07 como atípico y la historia mostrada conserva 4800.00 BOB"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-022 — Un periodo atípico se señala sin cambiar la historia mostrada

## Intención

Verifica el scenario "Mes de viaje" del requirement "Periodos atípicos señalados" de `forecast/expense-forecasting` (FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la historia variable de "Viajes y ocio" tiene 2026-07 con 4800.00 BOB y los demás periodos entre 300.00 BOB y 500.00 BOB
Entonces los motivos señalan 2026-07 como atípico y la historia mostrada conserva 4800.00 BOB
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
