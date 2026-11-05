---
id: TC-REPORTING-FORECAST-022
title: "Sin esenciales activados el disponible no cambia ni muestra ese término e informa el horizonte usado"
spec: reporting/dashboard
related_specs: []
requirement: "Disponible para gastar libre de compromisos"
scenario: "Esenciales no activados"
requirement_status: provisional
fr: ["FR-PLANNING-024","FR-REPORTING-002"]
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["spendable","q5"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos del disponible de octubre: líquidas 15800.00 BOB, reservado para metas 5000.00 BOB, comprometido 3179.00 BOB (\"Internet\" 199.00 del 2026-10-22, \"Luz\" 180.00 del 2026-10-28, \"Pago Tarjeta X\" 2500.00 del 2026-10-25, pendiente \"Cena\" 300.00), pendiente planificado de \"Fondo de emergencia\" 600.00 BOB, reserva mínima 1500.00 BOB"
input: {}
steps:
  - "Calcular el disponible con los ajustes por omisión"
expected_result:
  - "5521.00 BOB, sin término de esenciales"
  - "Horizonte: periodo financiero \"2026-10\""
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-022 — Sin esenciales activados el disponible no cambia ni muestra ese término e informa el horizonte usado

## Intención

Regresión: los valores por omisión no cambian la cifra de Phase 4 (D210).

## Escenario

```gherkin
Dado Datos del disponible de octubre: líquidas 15800.00 BOB, reservado para metas 5000.00 BOB, comprometido 3179.00 BOB ("Internet" 199.00 del 2026-10-22, "Luz" 180.00 del 2026-10-28, "Pago Tarjeta X" 2500.00 del 2026-10-25, pendiente "Cena" 300.00), pendiente planificado de "Fondo de emergencia" 600.00 BOB, reserva mínima 1500.00 BOB
Cuando Calcular el disponible con los ajustes por omisión
Entonces 5521.00 BOB, sin término de esenciales
  Y Horizonte: periodo financiero "2026-10"
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Disponible para gastar libre de compromisos" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
