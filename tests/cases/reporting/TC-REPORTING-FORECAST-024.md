---
id: TC-REPORTING-FORECAST-024
title: "Un horizonte que cruza de periodo suma lo planificado completo del periodo siguiente y sin ingreso usa 30 días"
spec: reporting/dashboard
related_specs: []
requirement: "Horizonte del disponible hasta el próximo ingreso"
scenario: "Horizonte que cruza al periodo siguiente"
requirement_status: confirmed
fr: ["FR-PLANNING-024","FR-GOALS-009"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/spendable.queries.test.ts
  - packages/contexts/reporting/src/domain/spendable-horizon.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["spendable","q5","horizon"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-27"
  - "Líquidas 15800.00 BOB, reservado 5000.00 BOB; \"Luz\" 180.00 (2026-10-28), \"Alquiler\" 2500.00 (2026-11-01), \"Internet\" 199.00 (2026-11-22); \"Fondo de emergencia\" 600.00 pendientes en \"2026-10\" y 1500.00 por mes; reserva 1500.00 BOB; \"Sueldo\" el 2026-11-05"
input: {}
steps:
  - "Calcular el disponible"
  - "Repetir el 2026-10-20 sin ingresos en 90 días"
expected_result:
  - "Horizonte 2026-10-27 a 2026-11-05; comprometido 2680.00; aportes 2100.00; disponible 4520.00 BOB"
  - "Sin ingreso: horizonte 2026-10-20 a 2026-11-19, indicado"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-024 — Un horizonte que cruza de periodo suma lo planificado completo del periodo siguiente y sin ingreso usa 30 días

## Intención

Bordes de periodo (RISK-020) en el horizonte por ingreso.

## Escenario

```gherkin
Dado Líquidas 15800.00 BOB, reservado 5000.00 BOB; "Luz" 180.00 (2026-10-28), "Alquiler" 2500.00 (2026-11-01), "Internet" 199.00 (2026-11-22); "Fondo de emergencia" 600.00 pendientes en "2026-10" y 1500.00 por mes; reserva 1500.00 BOB; "Sueldo" el 2026-11-05
Cuando Calcular el disponible
Entonces Horizonte 2026-10-27 a 2026-11-05; comprometido 2680.00; aportes 2100.00; disponible 4520.00 BOB
  Y Sin ingreso: horizonte 2026-10-20 a 2026-11-19, indicado
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Horizonte del disponible hasta el próximo ingreso" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
