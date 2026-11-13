---
id: TC-REPORTING-PREDICTED-003
title: "El gasto del periodo siguiente se reparte entre todos sus días"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Banda de gasto variable predicho en el calendario"
scenario: "Periodo siguiente dentro del horizonte"
requirement_status: confirmed
fr: ["FR-FORECAST-008","FR-REPORTING-014"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/predicted-cash-flow.queries.test.ts
  - packages/contexts/reporting/src/domain/predicted-spending-band.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["cash-flow","money"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el calendario de 30 días llega al 2026-12-20 y el gasto variable predicho de 2026-12 es 1550.00 BOB"
expected_result:
  - "cada día de diciembre del horizonte resta 50.00 BOB en la serie con gasto esperado"
created: 2026-11-12
updated: 2026-11-13
---

# TC-REPORTING-PREDICTED-003 — El gasto del periodo siguiente se reparte entre todos sus días

## Intención

Verifica el scenario "Periodo siguiente dentro del horizonte" del requirement "Banda de gasto variable predicho en el calendario" de `reporting/cash-flow-calendar` (FR-FORECAST-008, FR-REPORTING-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el calendario de 30 días llega al 2026-12-20 y el gasto variable predicho de 2026-12 es 1550.00 BOB
Entonces cada día de diciembre del horizonte resta 50.00 BOB en la serie con gasto esperado
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
