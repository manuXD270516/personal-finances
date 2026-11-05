---
id: TC-REPORTING-FORECAST-001
title: "El calendario de 30 días tiene un punto por día de hoy a hoy más 30 y un horizonte no admitido se rechaza"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Calendario de flujo de caja por horizonte"
scenario: "Horizonte de 30 días"
requirement_status: provisional
fr: ["FR-REPORTING-014"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","calendar"]
error_code: INVALID_FILTER
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
input: {"horizons":[30,45]}
steps:
  - "Pedir el calendario de 30 días"
  - "Pedir el calendario de 45 días"
expected_result:
  - "Calendario del 2026-10-20 al 2026-11-19 con 31 puntos"
  - "Horizonte 45: 400 INVALID_FILTER"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-001 — El calendario de 30 días tiene un punto por día de hoy a hoy más 30 y un horizonte no admitido se rechaza

## Intención

Solo los horizontes 7/30/60/90 de FR-REPORTING-014; nunca un horizonte arbitrario que la UI no sabe representar.

## Escenario

```gherkin
Dado FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)
Cuando Pedir el calendario de 30 días
Entonces Calendario del 2026-10-20 al 2026-11-19 con 31 puntos
  Y Horizonte 45: 400 INVALID_FILTER
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Calendario de flujo de caja por horizonte" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
