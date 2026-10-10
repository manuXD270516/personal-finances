---
id: TC-REPORTING-SPENDABLE-013
title: "El VIEWER ve el mismo disponible que el OWNER y los datos de otro workspace no lo afectan"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Disponible para todos los miembros y aislado por workspace"
scenario: "VIEWER consulta"
requirement_status: provisional
fr: ["FR-IDENTITY-006", "FR-REPORTING-001"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "rbac", "rls"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Datos base: líquidas \"Banco BOB\" 12000.00, \"Efectivo BOB\" 800.00 y \"Ahorro BOB\" 3000.00 BOB; metas: 3000.00 BOB reales de \"Fondo de emergencia\" en \"Ahorro BOB\" y 2000.00 BOB reservados para \"Laptop\" en \"Banco BOB\"; comprometido desde líquidas 3179.00 BOB (\"Internet\" 199.00, \"Luz\" ESTIMATED 180.00, \"Pago Tarjeta X\" 2500.00, pendiente \"Cena\" 300.00); pendiente planificado de \"Fondo de emergencia\" 600.00 BOB; reserva mínima 1500.00 BOB"
  - "Workspace \"W2\" con una reserva de 1000.00 BOB"
  - "Usuarios OWNER y VIEWER de W1"
input: {}
steps:
  - "GET W/reports/spendable como OWNER y como VIEWER"
  - "Registrar movimientos en W2 y repetir"
expected_result:
  - "Respuestas iguales (5521.00 BOB y mismo desglose)"
  - "Nada de W2 afecta a W1"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-013 — El VIEWER ve el mismo disponible que el OWNER y los datos de otro workspace no lo afectan

## Intención

FR-IDENTITY-006 y aislamiento (INV-025).

## Escenario

```gherkin
Cuando un VIEWER de "W1" abre el Home
Entonces ve el mismo disponible y desglose que el OWNER
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
