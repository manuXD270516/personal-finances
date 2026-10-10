---
id: TC-REPORTING-UPCOMING-015
title: "Con día de inicio 25 el comprometido usa el periodo financiero y no el mes calendario"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Total comprometido del periodo en el Home"
scenario: "Periodo financiero con día de inicio 25"
requirement_status: confirmed
fr: ["FR-COMMITMENTS-011","FR-REPORTING-016","FR-PLANNING-001"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/upcoming-payments.queries.test.ts
  - packages/contexts/reporting/src/domain/committed-period.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["committed","q4","financial-period"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio 25 (periodo \"2026-09\" = 2026-09-25..2026-10-24)"
  - "FixedClock en 2026-10-20T10:00:00-04:00; USD/BOB PARALLEL 12.00 vigente"
  - "No resueltas: Seguro 120.00 BOB (2026-09-28), Netflix 49.00 BOB (2026-10-15), Internet 199.00 BOB (2026-10-22), Spotify 5.99 USD (2026-10-25)"
  - "Pendiente \"Cena\" 300.00 BOB del 2026-10-18"
input: {"days":7}
steps:
  - "Consultar el bloque committed"
expected_result:
  - "Periodo \"2026-09\"; total = 668.00 BOB"
  - "Spotify no suma (periodo siguiente)"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-015 — Con día de inicio 25 el comprometido usa el periodo financiero y no el mes calendario

## Intención

El periodo vigente sale de planning/financial-periods (D59: etiqueta del mes de inicio), no del mes calendario.

## Escenario

```gherkin
Dado el día de inicio 25 y hoy 2026-10-20
Cuando abro el Home
Entonces el comprometido del periodo 2026-09 es 668.00 BOB sin Spotify
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
