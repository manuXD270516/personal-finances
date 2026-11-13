---
id: TC-FORECAST-EXPENSE-020
title: "La vista informa la diferencia entre categorías y total cuando supera el 5 %"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Diferencia entre categorías y total"
scenario: "Categorías que suman más que el total"
requirement_status: confirmed
fr: ["FR-FORECAST-001"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/forecasts/forecasts.test.tsx
  - packages/contexts/forecasting/src/application/expense-forecast.test.ts
  - packages/contexts/forecasting/src/domain/forecast-composer.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["coherence"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "para 2026-12 las categorías suman 4700.00 BOB y el gasto total esperado es 4408.00 BOB"
expected_result:
  - "la vista informa una diferencia de 292.00 BOB entre las categorías y el total"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-020 — La vista informa la diferencia entre categorías y total cuando supera el 5 %

## Intención

Verifica el scenario "Categorías que suman más que el total" del requirement "Diferencia entre categorías y total" de `forecast/expense-forecasting` (FR-FORECAST-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando para 2026-12 las categorías suman 4700.00 BOB y el gasto total esperado es 4408.00 BOB
Entonces la vista informa una diferencia de 292.00 BOB entre las categorías y el total
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
