---
id: TC-REPORTING-FORECAST-006
title: "El aporte programado de una meta hacia una cuenta no líquida y la cuota del préstamo restan con su origen y certeza"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Movimientos esperados del calendario y su certeza"
scenario: "Aporte a una meta hacia una cuenta no líquida y cuota de préstamo"
requirement_status: provisional
fr: ["FR-REPORTING-014","FR-DEBT-013"]
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
tags: ["cash-flow","goals","loans"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"Aporte Fondo de emergencia\" 1500.00 BOB del 2026-10-28 de \"Banco BOB\" a \"Plazo fijo\" (no líquida), administrado por la meta"
  - "\"Préstamo vehicular — cuota 7\" 1080.00 BOB del 2026-11-05 desde \"Banco BOB\""
input: {"horizon":30}
steps:
  - "Calcular el calendario de 30 días"
expected_result:
  - "Saldo del 2026-10-28: 2321.00 BOB"
  - "Saldo final 5620.50 BOB"
  - "Aporte con origen meta; cuota con certeza conocida"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-006 — El aporte programado de una meta hacia una cuenta no líquida y la cuota del préstamo restan con su origen y certeza

## Intención

Metas y deudas son fuentes del calendario vía las ocurrencias administradas (sin consultas nuevas a GOALS ni DEBT).

## Escenario

```gherkin
Dado "Préstamo vehicular — cuota 7" 1080.00 BOB del 2026-11-05 desde "Banco BOB"
Cuando Calcular el calendario de 30 días
Entonces Saldo del 2026-10-28: 2321.00 BOB
  Y Saldo final 5620.50 BOB
  Y Aporte con origen meta; cuota con certeza conocida
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Movimientos esperados del calendario y su certeza" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
