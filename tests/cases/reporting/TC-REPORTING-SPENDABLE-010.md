---
id: TC-REPORTING-SPENDABLE-010
title: "La segunda vista muestra el disponible del presupuesto del periodo o la acción de crear el plan"
spec: reporting/dashboard
related_specs: ["planning/budgets"]
requirement: "Disponible según el presupuesto del periodo"
scenario: "Las dos vistas"
requirement_status: provisional
fr: ["FR-PLANNING-024"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "budget"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB"
  - "Plan de \"2026-10\" con disponible para gastar 3750.00 BOB"
input: {}
steps:
  - "GET W/reports/summary"
  - "Borrar el escenario del plan (workspace sin plan de \"2026-10\") y repetir"
expected_result:
  - "spendable.consolidated 5521.00 BOB y budgetView {status: AVAILABLE, amount: 3750.00 BOB}"
  - "Sin plan: budgetView {status: NO_PLAN, action: CREATE_BUDGET} y la cifra principal sigue en 5521.00 BOB"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-010 — La segunda vista muestra el disponible del presupuesto del periodo o la acción de crear el plan

## Intención

docs/00 pregunta 3: ambas vistas (pregunta 1 de design.md).

## Escenario

```gherkin
Dado un plan con 3750.00 BOB disponibles y 5521.00 BOB libres de compromisos
Cuando abro el Home
Entonces veo 5521.00 BOB
  Y 3750.00 BOB según el presupuesto
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
