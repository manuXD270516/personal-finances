---
id: TC-REPORTING-REPORTS-015
title: "El reporte en una moneda habilitada distinta no cambia las cifras nativas y una no habilitada se rechaza"
spec: reporting/financial-reports
related_specs: []
requirement: "Moneda de reporte seleccionable"
scenario: "Reporte en dólares"
requirement_status: provisional
fr: ["FR-REPORTING-011"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["reporting-currency"]
error_code: "CURRENCY_NOT_ENABLED"
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "USD habilitada, EUR no habilitada"
  - "Sueldo 12000.00 BOB el 2026-10-05 con USD/BOB 10.00"
input:
  reportingCurrency: "USD | EUR"
steps:
  - "Pedir el reporte de 2026-10 en USD"
  - "Pedirlo en EUR"
expected_result:
  - "Ingreso consolidado 1200.00 USD; nativo 12000.00 BOB"
  - "EUR ⇒ 422 CURRENCY_NOT_ENABLED"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-015 — El reporte en una moneda habilitada distinta no cambia las cifras nativas y una no habilitada se rechaza

## Intención

Cambiar la moneda de reporte es solo presentación.

## Escenario

```gherkin
Dado un sueldo de 12000.00 BOB a USD/BOB 10.00
Cuando se pide el reporte con moneda de reporte USD
Entonces el ingreso consolidado es 1200.00 USD y el nativo sigue en 12000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
