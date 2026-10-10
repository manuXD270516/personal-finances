---
id: TC-DEBT-AMORT-040
title: 'Simulación de un extra único con ahorro y fecha de fin'
spec: debt/amortization
related_specs: []
requirement: 'Simulador de pagos extra en un préstamo'
scenario: 'Extra único'
requirement_status: provisional
fr: ['FR-DEBT-010']
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'simulator']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El VIEWER simula el préstamo de 12000.00 BOB al 12.00 % a 12 cuotas desde el 2026-11-15 con un extra único de 3000.00 BOB junto a la cuota 3'
expected_result:
  - 'El interés total es 546.74 BOB frente a 794.23 BOB, la fecha de fin es 2027-07-15 frente a 2027-10-15 y el ahorro es 247.49 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-040 — Simulación de un extra único con ahorro y fecha de fin

## Intención

FR-DEBT-010: escenario de pago extra único.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el VIEWER simula el préstamo de 12000.00 BOB al 12.00 % a 12 cuotas desde el 2026-11-15 con un extra único de 3000.00 BOB junto a la cuota 3
Entonces el interés total es 546.74 BOB frente a 794.23 BOB, la fecha de fin es 2027-07-15 frente a 2027-10-15 y el ahorro es 247.49 BOB
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
