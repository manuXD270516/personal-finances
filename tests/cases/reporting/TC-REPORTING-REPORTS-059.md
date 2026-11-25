---
id: TC-REPORTING-REPORTS-059
title: "Un cargo de tarjeta en la categoría de comisiones cuenta solo como tarjetas"
spec: reporting/financial-reports
related_specs: ["debt/credit-cards"]
requirement: "Reporte de comisiones"
scenario: "Cargo de tarjeta en la categoría de comisiones"
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
  - "en 2026-10 el único gasto en comisiones es un cargo de \"Visa Oro BOB\" de 12.00 BOB de comisiones, con su porción en \"Comisiones\""
expected_result:
  - "el reporte de 2026-10 informa tarjetas 12.00 BOB, categorías de comisiones 0.00 BOB y un total de 12.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-REPORTING-REPORTS-059 — Un cargo de tarjeta en la categoría de comisiones cuenta solo como tarjetas

## Intención

Verifica el scenario "Cargo de tarjeta en la categoría de comisiones" del requirement "Reporte de comisiones" de `reporting/financial-reports` (FR-REPORTING-008, FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando en 2026-10 el único gasto en comisiones es un cargo de "Visa Oro BOB" de 12.00 BOB de comisiones, con su porción en "Comisiones"
Entonces el reporte de 2026-10 informa tarjetas 12.00 BOB, categorías de comisiones 0.00 BOB y un total de 12.00 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
