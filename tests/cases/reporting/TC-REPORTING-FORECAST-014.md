---
id: TC-REPORTING-FORECAST-014
title: "El mínimo consolidado convierte cada moneda con la tasa vigente y sin tasa queda incompleto, nunca 1:1"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Consolidado informativo del calendario"
scenario: "BOB y USD consolidados"
requirement_status: provisional
fr: ["FR-REPORTING-014","FR-FX-006"]
nfr: ["NFR-DATA-002"]
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","fx"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"Caja USD\" 100.00 USD con \"Spotify\" 5.99 USD del 2026-10-25"
input: {"horizon":30,"rate":"USD/BOB PARALLEL 12.00"}
steps:
  - "Calcular con tasa 12.00"
  - "Calcular sin tasa USD/BOB en la ventana"
expected_result:
  - "Mínimo consolidado 4949.12 BOB el 2026-10-28 con tasa y fuente"
  - "Sin tasa: 3821.00 BOB el 2026-10-28, incompleto, USD no convertida"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-014 — El mínimo consolidado convierte cada moneda con la tasa vigente y sin tasa queda incompleto, nunca 1:1

## Intención

RISK-017: el consolidado es informativo y honesto.

## Escenario

```gherkin
Dado "Caja USD" 100.00 USD con "Spotify" 5.99 USD del 2026-10-25
Cuando Calcular con tasa 12.00
Entonces Mínimo consolidado 4949.12 BOB el 2026-10-28 con tasa y fuente
  Y Sin tasa: 3821.00 BOB el 2026-10-28, incompleto, USD no convertida
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Consolidado informativo del calendario" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
