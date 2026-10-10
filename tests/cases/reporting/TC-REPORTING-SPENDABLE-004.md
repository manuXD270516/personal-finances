---
id: TC-REPORTING-SPENDABLE-004
title: "Los vencidos de periodos anteriores restan del disponible y las transferencias entre cuentas líquidas no"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Compromisos descontados del disponible"
scenario: "Vencido de un periodo anterior"
requirement_status: provisional
fr: ["FR-COMMITMENTS-011", "FR-PLANNING-024"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "overdue"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB"
  - "Ocurrencia \"Seguro\" 120.00 BOB del 2026-09-28 desde \"Banco BOB\" sin resolver"
  - "Ocurrencia \"Ahorro mensual\" 500.00 BOB \"Banco BOB\" → \"Efectivo BOB\" del 2026-10-25"
input: {}
steps:
  - "Calcular el disponible"
expected_result:
  - "committed 3299.00 BOB y spendable 5401.00 BOB"
  - "\"Ahorro mensual\" no suma"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-004 — Los vencidos de periodos anteriores restan del disponible y las transferencias entre cuentas líquidas no

## Intención

Lo atrasado sigue por pagarse (pregunta 3); mover dinero entre líquidas no cambia lo que se puede gastar (D127).

## Escenario

```gherkin
Dado "Seguro" de 120.00 BOB vencido el 2026-09-28 sin resolver
Cuando calculo el disponible
Entonces el comprometido es 3299.00 BOB
  Y el disponible 5401.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
