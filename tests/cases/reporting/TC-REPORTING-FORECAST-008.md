---
id: TC-REPORTING-FORECAST-008
title: "El mismo día los egresos se aplican antes que los ingresos y el mínimo toma la primera fecha"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Saldo más bajo esperado con orden conservador dentro del día"
scenario: "Sueldo y alquiler el mismo día"
requirement_status: provisional
fr: ["FR-REPORTING-015"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","lowest-balance"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos de déficit: \"Banco BOB\" 2000.00 BOB, \"Efectivo BOB\" 500.00 BOB; \"Cena\" pendiente 300.00 BOB; \"Internet\" 199.00 (2026-10-22), \"Luz\" 180.00 (2026-10-28), \"Alquiler\" 2500.00 y \"Sueldo\" 8000.00 el 2026-11-01, \"Pago de tarjeta · Visa Oro\" 1120.50 BOB (2026-11-15)"
input: {"horizon":30}
steps:
  - "Calcular el calendario de 30 días"
  - "Repetir con los datos base (mínimo 3821.00 del 2026-10-28 al 2026-10-31)"
expected_result:
  - "Saldo más bajo −679.00 BOB el 2026-11-01; cierre del 2026-11-01 7321.00 BOB; final 6200.50 BOB"
  - "Con los datos base: 3821.00 BOB el 2026-10-28"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-008 — El mismo día los egresos se aplican antes que los ingresos y el mínimo toma la primera fecha

## Intención

Un sueldo que llega el mismo día que el alquiler no tapa el descubierto intradía (docs/14 §8.2).

## Escenario

```gherkin
Dado Datos de déficit: "Banco BOB" 2000.00 BOB, "Efectivo BOB" 500.00 BOB; "Cena" pendiente 300.00 BOB; "Internet" 199.00 (2026-10-22), "Luz" 180.00 (2026-10-28), "Alquiler" 2500.00 y "Sueldo" 8000.00 el 2026-11-01, "Pago de tarjeta · Visa Oro" 1120.50 BOB (2026-11-15)
Cuando Calcular el calendario de 30 días
Entonces Saldo más bajo −679.00 BOB el 2026-11-01; cierre del 2026-11-01 7321.00 BOB; final 6200.50 BOB
  Y Con los datos base: 3821.00 BOB el 2026-10-28
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Saldo más bajo esperado con orden conservador dentro del día" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
