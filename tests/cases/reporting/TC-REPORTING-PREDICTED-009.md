---
id: TC-REPORTING-PREDICTED-009
title: "La tarjeta Q3 muestra el gasto esperado del periodo con su rango"
spec: reporting/dashboard
related_specs: []
requirement: "Gasto esperado del periodo en el Home"
scenario: "Gasto esperado del periodo"
requirement_status: confirmed
fr: ["FR-FORECAST-001","FR-FORECAST-004","FR-REPORTING-001"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/dashboard/DashboardView.test.tsx
  - packages/contexts/reporting/src/application/predicted-cash-flow.queries.test.ts
  - tests/e2e/specs/predicted-cash-flow-band.spec.ts
status: automated
regression_suite: false
phase: 8
tags: ["home","ui"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el 2026-12-12 el gasto del periodo 2026-12 es 2980.00 BOB y el pronóstico vigente espera 4408.00 BOB con rango probable de 4038.00 BOB a 4788.00 BOB"
expected_result:
  - "la tarjeta Q3 muestra 2980.00 BOB gastados y el gasto esperado de 4408.00 BOB con rango probable de 4038.00 BOB a 4788.00 BOB (80 %), con los formatos del locale"
created: 2026-11-12
updated: 2026-11-13
---

# TC-REPORTING-PREDICTED-009 — La tarjeta Q3 muestra el gasto esperado del periodo con su rango

## Intención

Verifica el scenario "Gasto esperado del periodo" del requirement "Gasto esperado del periodo en el Home" de `reporting/dashboard` (FR-FORECAST-001, FR-FORECAST-004, FR-REPORTING-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el 2026-12-12 el gasto del periodo 2026-12 es 2980.00 BOB y el pronóstico vigente espera 4408.00 BOB con rango probable de 4038.00 BOB a 4788.00 BOB
Entonces la tarjeta Q3 muestra 2980.00 BOB gastados y el gasto esperado de 4408.00 BOB con rango probable de 4038.00 BOB a 4788.00 BOB (80 %), con los formatos del locale
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
