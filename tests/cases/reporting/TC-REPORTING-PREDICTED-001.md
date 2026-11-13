---
id: TC-REPORTING-PREDICTED-001
title: "La banda reparte por día lo que falta del periodo en curso sin tocar la serie principal"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Banda de gasto variable predicho en el calendario"
scenario: "Banda del periodo en curso"
requirement_status: confirmed
fr: ["FR-FORECAST-008","FR-REPORTING-014"]
nfr: []
invariants: ["INV-001","INV-002","INV-020"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/forecasting.api.test.ts
  - apps/web/src/ui/cash-flow/cash-flow.test.tsx
  - packages/contexts/forecasting/src/application/liquid-forecast.test.ts
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
  - "hoy es 2026-11-21, el periodo 2026-11 va del 2026-11-01 al 2026-11-30, el gasto variable líquido predicho de 2026-11 en BOB es 1500.00 BOB con intervalo del 80 % de 1200.00 BOB a 1900.00 BOB, ya se gastaron 1050.00 BOB variables en el periodo y la serie principal en BOB vale 5000.00 BOB todos los días"
expected_result:
  - "el calendario de 7 días informa el 2026-11-28 la serie con gasto esperado en 4640.00 BOB, con gasto alto en 4320.00 BOB y con gasto bajo en 4880.00 BOB"
  - "la serie principal del 2026-11-28 sigue en 5000.00 BOB"
created: 2026-11-12
updated: 2026-11-13
---

# TC-REPORTING-PREDICTED-001 — La banda reparte por día lo que falta del periodo en curso sin tocar la serie principal

## Intención

Verifica el scenario "Banda del periodo en curso" del requirement "Banda de gasto variable predicho en el calendario" de `reporting/cash-flow-calendar` (FR-FORECAST-008, FR-REPORTING-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando hoy es 2026-11-21, el periodo 2026-11 va del 2026-11-01 al 2026-11-30, el gasto variable líquido predicho de 2026-11 en BOB es 1500.00 BOB con intervalo del 80 % de 1200.00 BOB a 1900.00 BOB, ya se gastaron 1050.00 BOB variables en el periodo y la serie principal en BOB vale 5000.00 BOB todos los días
Entonces el calendario de 7 días informa el 2026-11-28 la serie con gasto esperado en 4640.00 BOB, con gasto alto en 4320.00 BOB y con gasto bajo en 4880.00 BOB
  Y la serie principal del 2026-11-28 sigue en 5000.00 BOB
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
