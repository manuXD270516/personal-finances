---
id: TC-REPORTING-PREDICTED-002
title: "Con el gasto ya superado lo que falta del periodo es cero"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Banda de gasto variable predicho en el calendario"
scenario: "Gasto ya superado en el periodo en curso"
requirement_status: confirmed
fr: ["FR-FORECAST-008","FR-REPORTING-014"]
nfr: []
invariants: []
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
tags: ["cash-flow"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "ya se gastaron 2000.00 BOB variables en 2026-11"
expected_result:
  - "lo que falta del periodo es 0.00 BOB para el valor esperado y para el límite superior, y las series adicionales coinciden con la principal hasta el 2026-11-30"
created: 2026-11-12
updated: 2026-11-13
---

# TC-REPORTING-PREDICTED-002 — Con el gasto ya superado lo que falta del periodo es cero

## Intención

Verifica el scenario "Gasto ya superado en el periodo en curso" del requirement "Banda de gasto variable predicho en el calendario" de `reporting/cash-flow-calendar` (FR-FORECAST-008, FR-REPORTING-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando ya se gastaron 2000.00 BOB variables en 2026-11
Entonces lo que falta del periodo es 0.00 BOB para el valor esperado y para el límite superior, y las series adicionales coinciden con la principal hasta el 2026-11-30
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
