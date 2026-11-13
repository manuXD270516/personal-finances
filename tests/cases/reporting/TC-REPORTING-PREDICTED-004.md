---
id: TC-REPORTING-PREDICTED-004
title: "El déficit es posible si solo la serie con gasto alto baja del umbral"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Probabilidad de déficit con el gasto variable predicho"
scenario: "Déficit posible solo con gasto alto"
requirement_status: confirmed
fr: ["FR-FORECAST-008","FR-REPORTING-015"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/cash-flow/cash-flow.test.tsx
  - packages/contexts/reporting/src/application/predicted-cash-flow.queries.test.ts
  - packages/contexts/reporting/src/domain/predicted-spending-band.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["cash-flow","shortfall"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la reserva mínima es 1500.00 BOB y en el horizonte el saldo más bajo es 2600.00 BOB en la serie principal, 2150.00 BOB con gasto esperado y 1380.00 BOB con gasto alto el 2026-12-14"
expected_result:
  - "la probabilidad de déficit en BOB es posible con fecha 2026-12-14"
created: 2026-11-12
updated: 2026-11-13
---

# TC-REPORTING-PREDICTED-004 — El déficit es posible si solo la serie con gasto alto baja del umbral

## Intención

Verifica el scenario "Déficit posible solo con gasto alto" del requirement "Probabilidad de déficit con el gasto variable predicho" de `reporting/cash-flow-calendar` (FR-FORECAST-008, FR-REPORTING-015).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la reserva mínima es 1500.00 BOB y en el horizonte el saldo más bajo es 2600.00 BOB en la serie principal, 2150.00 BOB con gasto esperado y 1380.00 BOB con gasto alto el 2026-12-14
Entonces la probabilidad de déficit en BOB es posible con fecha 2026-12-14
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
