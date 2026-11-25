---
id: TC-DEBT-CARD-050
title: "Anular un cargo de un periodo cerrado se rechaza"
spec: debt/credit-cards
related_specs: []
requirement: "Anular un cargo de la tarjeta"
scenario: "Cargo de un mes cerrado"
requirement_status: provisional
fr: ["FR-DEBT-013"]
nfr: []
invariants: ["INV-015"]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: PERIOD_CLOSED
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el periodo 2026-10 está cerrado y el EDITOR anula el cargo de 4.80 BOB del 2026-10-25"
expected_result:
  - "se rechaza con `PERIOD_CLOSED` y el cargo y su transacción siguen vigentes"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-050 — Anular un cargo de un periodo cerrado se rechaza

## Intención

Verifica el scenario "Cargo de un mes cerrado" del requirement "Anular un cargo de la tarjeta" de `debt/credit-cards` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el periodo 2026-10 está cerrado y el EDITOR anula el cargo de 4.80 BOB del 2026-10-25
Entonces se rechaza con `PERIOD_CLOSED` y el cargo y su transacción siguen vigentes
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
