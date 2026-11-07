---
id: TC-REPORTING-FORECAST-007
title: "Los egresos de rango usan el máximo, los ingresos de rango el mínimo y los variables no suman"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Montos conservadores según el tipo de monto"
scenario: "Rangos y montos variables"
requirement_status: confirmed
fr: ["FR-REPORTING-014","FR-COMMITMENTS-004"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-calendar.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","amount-type"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "\"Gimnasio\" MIN_MAX 150.00–200.00 BOB, ingreso \"Freelance\" MIN_MAX 1000.00–3000.00 BOB y \"Agua\" VARIABLE, todos en \"Banco BOB\" dentro de 30 días"
input: {"horizon":30}
steps:
  - "Calcular el calendario de 30 días"
expected_result:
  - "\"Gimnasio\" resta 200.00 BOB"
  - "\"Freelance\" suma 1000.00 BOB"
  - "\"Agua\" sin monto; 1 movimiento sin monto en BOB"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-007 — Los egresos de rango usan el máximo, los ingresos de rango el mínimo y los variables no suman

## Intención

Peor caso honesto (FR-COMMITMENTS-004) y nunca un 0 inventado (D115).

## Escenario

```gherkin
Dado "Gimnasio" MIN_MAX 150.00–200.00 BOB, ingreso "Freelance" MIN_MAX 1000.00–3000.00 BOB y "Agua" VARIABLE, todos en "Banco BOB" dentro de 30 días
Cuando Calcular el calendario de 30 días
Entonces "Gimnasio" resta 200.00 BOB
  Y "Freelance" suma 1000.00 BOB
  Y "Agua" sin monto; 1 movimiento sin monto en BOB
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Montos conservadores según el tipo de monto" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
