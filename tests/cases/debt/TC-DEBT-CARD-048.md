---
id: TC-DEBT-CARD-048
title: "Se propone registrar como cargo la diferencia con el banco sin crear asientos"
spec: debt/credit-cards
related_specs: []
requirement: "Propuesta de cargos desde la diferencia con el banco"
scenario: "Propuesta de 4.80 BOB"
requirement_status: provisional
fr: ["FR-DEBT-013"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el estado de cuenta cerrado el 2026-10-25 tiene saldo facturado recalculado 1120.50 BOB y el banco informó 1125.30 BOB"
expected_result:
  - "se ofrece registrar un cargo con fecha 2026-10-25 por un total de 4.80 BOB a repartir entre componentes"
  - "no se registra ningún asiento hasta que el EDITOR confirma el reparto"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-048 — Se propone registrar como cargo la diferencia con el banco sin crear asientos

## Intención

Verifica el scenario "Propuesta de 4.80 BOB" del requirement "Propuesta de cargos desde la diferencia con el banco" de `debt/credit-cards` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el estado de cuenta cerrado el 2026-10-25 tiene saldo facturado recalculado 1120.50 BOB y el banco informó 1125.30 BOB
Entonces se ofrece registrar un cargo con fecha 2026-10-25 por un total de 4.80 BOB a repartir entre componentes
Y no se registra ningún asiento hasta que el EDITOR confirma el reparto
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
