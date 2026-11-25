---
id: TC-REPORTING-REPORTS-058
title: "El reporte de comisiones cuenta los cargos de tarjeta en el tipo tarjetas"
spec: reporting/financial-reports
related_specs: ["debt/credit-cards"]
requirement: "Reporte de comisiones"
scenario: "Intereses y cargos de tarjeta en octubre"
requirement_status: provisional
fr: ["FR-REPORTING-008","FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["reports","fees","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "además en 2026-10 se registró en \"Visa Oro BOB\" el cargo del 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro"
expected_result:
  - "el reporte de 2026-10 informa tarjetas 4.80 BOB y un total de 426.80 BOB, sin cambiar los demás tipos"
created: 2026-11-25
updated: 2026-11-25
---
# TC-REPORTING-REPORTS-058 — El reporte de comisiones cuenta los cargos de tarjeta en el tipo tarjetas

## Intención

Verifica el scenario "Intereses y cargos de tarjeta en octubre" del requirement "Reporte de comisiones" de `reporting/financial-reports` (FR-REPORTING-008, FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando además en 2026-10 se registró en "Visa Oro BOB" el cargo del 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro
Entonces el reporte de 2026-10 informa tarjetas 4.80 BOB y un total de 426.80 BOB, sin cambiar los demás tipos
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
