---
id: TC-REPORTING-FORECAST-002
title: "El hoy del calendario es la fecha local del workspace y no la fecha UTC"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Calendario de flujo de caja por horizonte"
scenario: "Consulta de noche en La Paz"
requirement_status: confirmed
fr: ["FR-REPORTING-014"]
nfr: ["NFR-USAB-004"]
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","timezone"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T23:30:00-04:00 (2026-10-21T03:30:00Z)"
input: {"horizon":7}
steps:
  - "Pedir el calendario de 7 días"
expected_result:
  - "El calendario va del 2026-10-20 al 2026-10-27"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-002 — El hoy del calendario es la fecha local del workspace y no la fecha UTC

## Intención

RISK-020: a las 23:30 de La Paz ya es el día siguiente en UTC; el calendario no debe correrse un día.

## Escenario

```gherkin
Dado FixedClock en 2026-10-20T23:30:00-04:00 (2026-10-21T03:30:00Z)
Cuando Pedir el calendario de 7 días
Entonces El calendario va del 2026-10-20 al 2026-10-27
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Calendario de flujo de caja por horizonte" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
