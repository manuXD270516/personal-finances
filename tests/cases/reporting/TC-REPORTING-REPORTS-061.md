---
id: TC-REPORTING-REPORTS-061
title: "Un interés de tarjeta cargado a mano sin adoptar no cuenta como tarjetas"
spec: reporting/financial-reports
related_specs: ["debt/credit-cards"]
requirement: "Reporte de comisiones"
scenario: "Interés cargado a mano sin adoptar"
requirement_status: provisional
fr: ["FR-REPORTING-008","FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
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
  - "en 2026-10 el único gasto de \"Visa Oro BOB\" en \"Intereses pagados\" es un gasto manual de 4.80 BOB que no se adoptó como cargo"
expected_result:
  - "el reporte de 2026-10 informa tarjetas 0.00 BOB y un total de 0.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-REPORTING-REPORTS-061 — Un interés de tarjeta cargado a mano sin adoptar no cuenta como tarjetas

## Intención

Verifica el scenario "Interés cargado a mano sin adoptar" del requirement "Reporte de comisiones" de `reporting/financial-reports` (FR-REPORTING-008, FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando en 2026-10 el único gasto de "Visa Oro BOB" en "Intereses pagados" es un gasto manual de 4.80 BOB que no se adoptó como cargo
Entonces el reporte de 2026-10 informa tarjetas 0.00 BOB y un total de 0.00 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
