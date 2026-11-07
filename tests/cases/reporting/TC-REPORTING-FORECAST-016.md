---
id: TC-REPORTING-FORECAST-016
title: "Un déficit en BOB cubrible con USD sugiere convertir el equivalente aproximado antes de la fecha"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Sugerencia de conversión ante un déficit cubrible"
scenario: "Convertir dólares antes del alquiler"
requirement_status: confirmed
fr: ["FR-REPORTING-015"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/cash-flow/cash-flow.test.tsx
  - packages/contexts/reporting/src/application/cash-flow-calendar.queries.test.ts
  - packages/contexts/reporting/src/domain/cash-flow-risk.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["cash-flow","suggestion"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos de déficit: \"Banco BOB\" 2000.00 BOB, \"Efectivo BOB\" 500.00 BOB; \"Cena\" pendiente 300.00 BOB; \"Internet\" 199.00 (2026-10-22), \"Luz\" 180.00 (2026-10-28), \"Alquiler\" 2500.00 y \"Sueldo\" 8000.00 el 2026-11-01, \"Pago de tarjeta · Visa Oro\" 1120.50 BOB (2026-11-15)"
  - "Reserva mínima 1500.00 BOB"
  - "\"Caja USD\" 400.00 USD sin egresos"
  - "Tasa USD/BOB 12.00"
input: {"horizon":30}
steps:
  - "Calcular el calendario"
expected_result:
  - "Sugerencia: convertir aproximadamente 181.58 USD a BOB antes del 2026-11-01"
  - "Ninguna acción ejecutada"
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-016 — Un déficit en BOB cubrible con USD sugiere convertir el equivalente aproximado antes de la fecha

## Intención

docs/14 §8.2 paso 8: sugerir, nunca actuar.

## Escenario

```gherkin
Dado Tasa USD/BOB 12.00
Cuando Calcular el calendario
Entonces Sugerencia: convertir aproximadamente 181.58 USD a BOB antes del 2026-11-01
  Y Ninguna acción ejecutada
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Sugerencia de conversión ante un déficit cubrible" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
