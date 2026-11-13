---
id: TC-REPORTING-PREDICTED-005
title: "El déficit es probable si la serie con gasto esperado baja del umbral"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Probabilidad de déficit con el gasto variable predicho"
scenario: "Déficit probable con gasto esperado"
requirement_status: provisional
fr: ["FR-FORECAST-008","FR-REPORTING-015"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["cash-flow","shortfall"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el saldo más bajo con gasto esperado es 1420.00 BOB el 2026-12-10"
expected_result:
  - "la probabilidad de déficit en BOB es probable con fecha 2026-12-10"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-PREDICTED-005 — El déficit es probable si la serie con gasto esperado baja del umbral

## Intención

Verifica el scenario "Déficit probable con gasto esperado" del requirement "Probabilidad de déficit con el gasto variable predicho" de `reporting/cash-flow-calendar` (FR-FORECAST-008, FR-REPORTING-015).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el saldo más bajo con gasto esperado es 1420.00 BOB el 2026-12-10
Entonces la probabilidad de déficit en BOB es probable con fecha 2026-12-10
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
