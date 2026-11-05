---
id: TC-REPORTING-FORECAST-009
title: "El riesgo es alto con faltante contra la reserva mínima o contra cero y se indica si el mínimo es negativo"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Riesgo de déficit por moneda"
scenario: "Déficit por debajo de cero"
requirement_status: provisional
fr: ["FR-REPORTING-015","FR-IDENTITY-005"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","shortfall"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos de déficit: \"Banco BOB\" 2000.00 BOB, \"Efectivo BOB\" 500.00 BOB; \"Cena\" pendiente 300.00 BOB; \"Internet\" 199.00 (2026-10-22), \"Luz\" 180.00 (2026-10-28), \"Alquiler\" 2500.00 y \"Sueldo\" 8000.00 el 2026-11-01, \"Pago de tarjeta · Visa Oro\" 1120.50 BOB (2026-11-15)"
input: {"horizon":30,"minimumReserve":"1500.00 BOB"}
steps:
  - "Calcular con reserva 1500.00 BOB"
  - "Calcular sin reserva"
  - "Calcular con \"Banco BOB\" 3300.00 BOB y reserva 1500.00 BOB"
expected_result:
  - "HIGH, primera fecha 2026-11-01, faltante 2179.00 BOB, negativo"
  - "Sin reserva: umbral 0.00 BOB, HIGH, faltante 679.00 BOB"
  - "Con 3300.00: mínimo 621.00 BOB, HIGH, faltante 879.00 BOB, no negativo"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-009 — El riesgo es alto con faltante contra la reserva mínima o contra cero y se indica si el mínimo es negativo

## Intención

FR-REPORTING-015: déficit es saldo < 0 o < reserva mínima, con monto y fecha.

## Escenario

```gherkin
Dado Datos de déficit: "Banco BOB" 2000.00 BOB, "Efectivo BOB" 500.00 BOB; "Cena" pendiente 300.00 BOB; "Internet" 199.00 (2026-10-22), "Luz" 180.00 (2026-10-28), "Alquiler" 2500.00 y "Sueldo" 8000.00 el 2026-11-01, "Pago de tarjeta · Visa Oro" 1120.50 BOB (2026-11-15)
Cuando Calcular con reserva 1500.00 BOB
Entonces HIGH, primera fecha 2026-11-01, faltante 2179.00 BOB, negativo
  Y Sin reserva: umbral 0.00 BOB, HIGH, faltante 679.00 BOB
  Y Con 3300.00: mínimo 621.00 BOB, HIGH, faltante 879.00 BOB, no negativo
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Riesgo de déficit por moneda" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
