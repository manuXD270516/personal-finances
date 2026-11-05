---
id: TC-REPORTING-FORECAST-023
title: "Con el modo hasta el próximo ingreso el horizonte termina en el próximo sueldo y los ingresos atrasados no lo fijan"
spec: reporting/dashboard
related_specs: []
requirement: "Horizonte del disponible hasta el próximo ingreso"
scenario: "Sueldo antes de la luz"
requirement_status: provisional
fr: ["FR-PLANNING-024","FR-REPORTING-014"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["spendable","q5","horizon"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos del disponible de octubre: líquidas 15800.00 BOB, reservado para metas 5000.00 BOB, comprometido 3179.00 BOB (\"Internet\" 199.00 del 2026-10-22, \"Luz\" 180.00 del 2026-10-28, \"Pago Tarjeta X\" 2500.00 del 2026-10-25, pendiente \"Cena\" 300.00), pendiente planificado de \"Fondo de emergencia\" 600.00 BOB, reserva mínima 1500.00 BOB"
  - "Modo \"hasta el próximo ingreso\""
input: {}
steps:
  - "\"Sueldo\" vence el 2026-10-26"
  - "\"Sueldo\" del 2026-10-18 sin resolver y el siguiente el 2026-11-18"
expected_result:
  - "Horizonte 2026-10-20 a 2026-10-26; comprometido 2999.00 BOB; disponible 5701.00 BOB"
  - "Horizonte hasta el 2026-11-18"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-023 — Con el modo hasta el próximo ingreso el horizonte termina en el próximo sueldo y los ingresos atrasados no lo fijan

## Intención

D210 difirió el horizonte por ingreso a Phase 7 (docs/14 §4.2).

## Escenario

```gherkin
Dado Modo "hasta el próximo ingreso"
Cuando "Sueldo" vence el 2026-10-26
Entonces Horizonte 2026-10-20 a 2026-10-26; comprometido 2999.00 BOB; disponible 5701.00 BOB
  Y Horizonte hasta el 2026-11-18
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Horizonte del disponible hasta el próximo ingreso" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
