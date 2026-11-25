---
id: TC-DEBT-CARD-047
title: "El estado de cuenta lista el cargo y la diferencia con el banco queda en cero"
spec: debt/credit-cards
related_specs: []
requirement: "Cargos registrados en el estado de cuenta"
scenario: "Diferencia con el banco cubierta por el cargo"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/card-charges.api.test.ts
  - packages/contexts/debt/src/application/card-charges.service.test.ts
  - tests/e2e/specs/card-charges.spec.ts
status: automated
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
  - "el estado de cuenta cerrado el 2026-10-25 de \"Visa Oro BOB\" se emitió con saldo facturado 1120.50 BOB, el banco informó 1125.30 BOB y se registra el cargo de 4.00 BOB de interés y 0.80 BOB de seguro con fecha 2026-10-25"
expected_result:
  - "el detalle lista ese cargo con total 4.80 BOB, el saldo facturado recalculado es 1125.30 BOB, la diferencia con lo emitido es 4.80 BOB y la diferencia con lo informado por el banco es 0.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-047 — El estado de cuenta lista el cargo y la diferencia con el banco queda en cero

## Intención

Verifica el scenario "Diferencia con el banco cubierta por el cargo" del requirement "Cargos registrados en el estado de cuenta" de `debt/credit-cards` (FR-DEBT-013).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el estado de cuenta cerrado el 2026-10-25 de "Visa Oro BOB" se emitió con saldo facturado 1120.50 BOB, el banco informó 1125.30 BOB y se registra el cargo de 4.00 BOB de interés y 0.80 BOB de seguro con fecha 2026-10-25
Entonces el detalle lista ese cargo con total 4.80 BOB, el saldo facturado recalculado es 1125.30 BOB, la diferencia con lo emitido es 4.80 BOB y la diferencia con lo informado por el banco es 0.00 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
