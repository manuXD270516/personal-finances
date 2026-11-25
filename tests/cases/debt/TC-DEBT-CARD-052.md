---
id: TC-DEBT-CARD-052
title: "Adoptar un gasto con componentes que no suman su monto se rechaza"
spec: debt/credit-cards
related_specs: []
requirement: "Adoptar un gasto existente como cargo de la tarjeta"
scenario: "Componentes que no suman el gasto"
requirement_status: provisional
fr: ["FR-DEBT-013"]
nfr: []
invariants: ["INV-021"]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: CARD_CHARGE_INVALID
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el EDITOR adopta el gasto \"Interés Visa\" de 4.80 BOB con 4.00 BOB de interés y 1.00 BOB de seguro"
expected_result:
  - "se rechaza con `CARD_CHARGE_INVALID` y la transacción no cambia"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-052 — Adoptar un gasto con componentes que no suman su monto se rechaza

## Intención

Verifica el scenario "Componentes que no suman el gasto" del requirement "Adoptar un gasto existente como cargo de la tarjeta" de `debt/credit-cards` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el EDITOR adopta el gasto "Interés Visa" de 4.80 BOB con 4.00 BOB de interés y 1.00 BOB de seguro
Entonces se rechaza con `CARD_CHARGE_INVALID` y la transacción no cambia
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
