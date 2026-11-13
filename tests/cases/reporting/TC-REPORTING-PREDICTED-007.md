---
id: TC-REPORTING-PREDICTED-007
title: "Una moneda con datos insuficientes queda sin banda con su motivo"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Calendario sin pronóstico disponible"
scenario: "Serie en dólares con datos insuficientes"
requirement_status: confirmed
fr: ["FR-FORECAST-006","FR-FORECAST-008"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/predicted-cash-flow.queries.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["cash-flow","readiness"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la serie de gasto variable líquido en USD tiene 2 periodos de historia"
expected_result:
  - "el calendario muestra la banda en BOB y para USD informa datos insuficientes sin banda"
created: 2026-11-12
updated: 2026-11-13
---

# TC-REPORTING-PREDICTED-007 — Una moneda con datos insuficientes queda sin banda con su motivo

## Intención

Verifica el scenario "Serie en dólares con datos insuficientes" del requirement "Calendario sin pronóstico disponible" de `reporting/cash-flow-calendar` (FR-FORECAST-006, FR-FORECAST-008).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la serie de gasto variable líquido en USD tiene 2 periodos de historia
Entonces el calendario muestra la banda en BOB y para USD informa datos insuficientes sin banda
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
