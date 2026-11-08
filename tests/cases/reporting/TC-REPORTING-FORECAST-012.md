---
id: TC-REPORTING-FORECAST-012
title: "El peor caso sin ingresos esperados se informa sin cambiar el riesgo"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Serie sin ingresos esperados"
scenario: "Peor caso sin sueldo"
requirement_status: confirmed
fr: ["FR-REPORTING-014"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-calendar.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","worst-case"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "Reserva mínima 1500.00 BOB"
input: {"horizon":30}
steps:
  - "Calcular el calendario"
expected_result:
  - "Peor caso: mínimo 200.50 BOB el 2026-11-15 y final 200.50 BOB"
  - "Riesgo en BOB NONE (serie principal)"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-012 — El peor caso sin ingresos esperados se informa sin cambiar el riesgo

## Intención

Mostrar qué pasa si el sueldo no llega, sin alarmar por defecto.

## Escenario

```gherkin
Dado Reserva mínima 1500.00 BOB
Cuando Calcular el calendario
Entonces Peor caso: mínimo 200.50 BOB el 2026-11-15 y final 200.50 BOB
  Y Riesgo en BOB NONE (serie principal)
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Serie sin ingresos esperados" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
