---
id: TC-REPORTING-SPENDABLE-003
title: "El aporte programado de una meta hacia una cuenta no líquida se descuenta una sola vez, como aporte planificado"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Compromisos descontados del disponible"
scenario: "Aporte programado de una meta contado una sola vez"
requirement_status: provisional
fr: ["FR-COMMITMENTS-011", "FR-GOALS-009"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "goals", "double-count"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB"
  - "Ocurrencia \"Aporte Fondo de emergencia\" 1500.00 BOB \"Banco BOB\" → \"Plazo fijo\" (ILLIQUID) del 2026-10-28 con managedBy GOAL"
  - "Pendiente planificado de \"Fondo de emergencia\" 1500.00 BOB"
input: {}
steps:
  - "Calcular el disponible"
  - "Consultar Q4 del mismo periodo"
expected_result:
  - "committed 3179.00 BOB (sin la ocurrencia de la meta), plannedGoalContributions 1500.00 BOB, spendable 4621.00 BOB"
  - "Q4 sí incluye la ocurrencia (regla D127 sin cambios)"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-003 — El aporte programado de una meta hacia una cuenta no líquida se descuenta una sola vez, como aporte planificado

## Intención

Sin doble conteo entre compromisos y metas (decisión 5 de design.md).

## Escenario

```gherkin
Dado el aporte programado de 1500.00 BOB de "Fondo de emergencia" hacia "Plazo fijo"
Cuando calculo el disponible
Entonces el comprometido sigue en 3179.00 BOB
  Y el disponible es 4621.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
