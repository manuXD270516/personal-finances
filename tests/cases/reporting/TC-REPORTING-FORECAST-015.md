---
id: TC-REPORTING-FORECAST-015
title: "Si el motor genera ocurrencias hasta 60 días el calendario de 90 días se marca con cobertura incompleta"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Cobertura de los compromisos en el horizonte"
scenario: "Horizonte de generación de 60 días"
requirement_status: confirmed
fr: ["FR-REPORTING-014","FR-COMMITMENTS-011"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","coverage"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "COMMITMENTS_HORIZON_DAYS=60"
input: {"horizon":90}
steps:
  - "Pedir el calendario de 90 días"
expected_result:
  - "Hasta el 2027-01-18 con cobertura hasta el 2026-12-19, incompleta"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-015 — Si el motor genera ocurrencias hasta 60 días el calendario de 90 días se marca con cobertura incompleta

## Intención

No dar por seguro un periodo sin ocurrencias generadas.

## Escenario

```gherkin
Dado COMMITMENTS_HORIZON_DAYS=60
Cuando Pedir el calendario de 90 días
Entonces Hasta el 2027-01-18 con cobertura hasta el 2026-12-19, incompleta
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Cobertura de los compromisos en el horizonte" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
