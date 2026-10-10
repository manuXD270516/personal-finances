---
id: TC-REPORTING-SPENDABLE-001
title: "El disponible del periodo resta reservas de metas, comprometido, aportes planificados y reserva mínima, sin sumar ingresos esperados"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Disponible para gastar libre de compromisos"
scenario: "Disponible de octubre"
requirement_status: provisional
fr: ["FR-PLANNING-024", "FR-GOALS-009", "FR-COMMITMENTS-011", "FR-REPORTING-002"]
nfr: ["NFR-DATA-002"]
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB"
  - "Ocurrencia de ingreso \"Sueldo\" 8000.00 BOB del 2026-10-30"
input: {}
steps:
  - "Calcular el disponible"
  - "Repetir sin reserva mínima"
expected_result:
  - "spendable 5521.00 BOB con términos liquid 15800.00, reservedForGoals 5000.00, committed 3179.00, plannedGoalContributions 600.00, minimumReserve 1500.00"
  - "\"Sueldo\" no suma"
  - "Sin reserva mínima: 7021.00 BOB y sin término minimumReserve"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-001 — El disponible del periodo resta reservas de metas, comprometido, aportes planificados y reserva mínima, sin sumar ingresos esperados

## Intención

Q5 completo (docs/00 §6): cifra conservadora y explicable término por término.

## Escenario

```gherkin
Dados 15800.00 BOB líquidos, 5000.00 BOB reservados para metas, 3179.00 BOB comprometidos, 600.00 BOB de aportes planificados y 1500.00 BOB de reserva mínima
Cuando calculo el disponible para gastar
Entonces es 5521.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
