---
id: TC-REPORTING-SPENDABLE-012
title: "Una reserva recién registrada se refleja en la siguiente consulta del disponible con periodo, moneda y frescura"
spec: reporting/dashboard
related_specs: ["goals/savings-goals"]
requirement: "Frescura y lectura inmediata del disponible"
scenario: "Reserva recién registrada"
requirement_status: provisional
fr: ["FR-REPORTING-007", "FR-PLANNING-024"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "freshness"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB"
input: {"earmark": "500.00 BOB de \"Banco BOB\" para \"Laptop\""}
steps:
  - "GET W/reports/spendable"
  - "POST de la reserva"
  - "GET W/reports/spendable inmediatamente"
expected_result:
  - "Antes 5521.00 BOB; después 5021.00 BOB"
  - "La respuesta indica periodo \"2026-10\", moneda BOB, generatedAt y dataFreshness"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-012 — Una reserva recién registrada se refleja en la siguiente consulta del disponible con periodo, moneda y frescura

## Intención

Read-your-writes como Q4/Q8 (D117).

## Escenario

```gherkin
Dado un disponible de 5521.00 BOB
Cuando el EDITOR reserva 500.00 BOB y consulto de inmediato
Entonces el disponible es 5021.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
