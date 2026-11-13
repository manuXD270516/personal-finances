---
id: TC-FORECAST-EXPENSE-002
title: "La historia variable resta los recurrentes resueltos del periodo"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Historia variable sin doble conteo de lo recurrente"
scenario: "Periodo con recurrentes resueltos"
requirement_status: confirmed
fr: ["FR-FORECAST-003"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/commitments/src/application/forecast-sources.test.ts
  - packages/contexts/commitments/test/integration/pg-commitments.int.test.ts
  - packages/contexts/forecasting/src/application/expense-forecast.test.ts
  - packages/contexts/forecasting/src/domain/variable-history.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["known-future"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "en el periodo 2026-10 el gasto total fue 4300.00 BOB y las ocurrencias resueltas de gasto suman 2748.00 BOB"
expected_result:
  - "la historia variable del gasto total en 2026-10 es 1552.00 BOB"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-EXPENSE-002 — La historia variable resta los recurrentes resueltos del periodo

## Intención

Verifica el scenario "Periodo con recurrentes resueltos" del requirement "Historia variable sin doble conteo de lo recurrente" de `forecast/expense-forecasting` (FR-FORECAST-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando en el periodo 2026-10 el gasto total fue 4300.00 BOB y las ocurrencias resueltas de gasto suman 2748.00 BOB
Entonces la historia variable del gasto total en 2026-10 es 1552.00 BOB
```

## Notas

- Change `add-expense-forecasts` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
