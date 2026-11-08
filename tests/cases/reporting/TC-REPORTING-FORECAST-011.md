---
id: TC-REPORTING-FORECAST-011
title: "El restante del plan se reparte por día, descuenta compromisos de la misma categoría y solo cambia la serie planificada"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Gasto planificado restante del plan como estimación"
scenario: "Supermercado restante repartido"
requirement_status: confirmed
fr: ["FR-REPORTING-014","FR-PLANNING-024"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-calendar.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-risk.test.ts
  - packages/contexts/reporting/src/domain/planned-spending.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","budget"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "Reserva mínima 3500.00 BOB"
  - "Plan \"2026-10\": \"Supermercado\" 1200.00 BOB planificados, 600.00 BOB gastados; \"2026-11\" sin plan"
input: {"horizon":30}
steps:
  - "Calcular el calendario"
  - "Agregar la ocurrencia \"Canasta\" 240.00 BOB del 2026-10-25 de categoría \"Supermercado\""
expected_result:
  - "50.00 BOB por día del 2026-10-20 al 2026-10-31; mínimo planificado 3221.00 BOB el 2026-10-31; riesgo POSSIBLE desde el 2026-10-28; \"2026-11\" sin plan"
  - "Con \"Canasta\": 30.00 BOB por día y \"Canasta\" resta 240.00 BOB en la serie principal"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-011 — El restante del plan se reparte por día, descuenta compromisos de la misma categoría y solo cambia la serie planificada

## Intención

El plan del mes como fuente sin doble conteo con los compromisos (decisión 7).

## Escenario

```gherkin
Dado Plan "2026-10": "Supermercado" 1200.00 BOB planificados, 600.00 BOB gastados; "2026-11" sin plan
Cuando Calcular el calendario
Entonces 50.00 BOB por día del 2026-10-20 al 2026-10-31; mínimo planificado 3221.00 BOB el 2026-10-31; riesgo POSSIBLE desde el 2026-10-28; "2026-11" sin plan
  Y Con "Canasta": 30.00 BOB por día y "Canasta" resta 240.00 BOB en la serie principal
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Gasto planificado restante del plan como estimación" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
