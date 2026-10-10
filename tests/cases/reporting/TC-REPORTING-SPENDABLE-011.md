---
id: TC-REPORTING-SPENDABLE-011
title: "Con día de inicio 25 el disponible usa el periodo vigente en La Paz y no resta vencimientos posteriores"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Periodo del disponible en la zona del workspace"
scenario: "Mes financiero que empieza el día 25"
requirement_status: provisional
fr: ["FR-PLANNING-024"]
nfr: ["NFR-USAB-004"]
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "periods", "timezone"]
error_code: null
preconditions:
  - "Workspace con día de inicio 25 y TZ America/La_Paz"
  - "FixedClock en 2026-10-20 (y en 2026-10-24T23:30:00-04:00 con TZ del proceso UTC)"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB; \"Internet\" vence el 2026-10-22, \"Pago Tarjeta X\" el 2026-10-25, \"Luz\" el 2026-10-28 y \"Cena\" es del 2026-10-18"
input: {}
steps:
  - "Calcular el disponible"
expected_result:
  - "Periodo \"2026-09\" (2026-09-25 a 2026-10-24)"
  - "committed 499.00 BOB y spendable 8201.00 BOB"
  - "A las 23:30 del 24 en La Paz sigue el periodo \"2026-09\""
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-011 — Con día de inicio 25 el disponible usa el periodo vigente en La Paz y no resta vencimientos posteriores

## Intención

RISK-020: "hoy" y periodo en la zona del workspace.

## Escenario

```gherkin
Dado un mes financiero que empieza el día 25 y hoy 2026-10-20
Cuando calculo el disponible
Entonces el comprometido es 499.00 BOB
  Y el disponible 8201.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
