---
id: TC-DEBT-AMORT-031
title: 'Prepago reduciendo el plazo: misma cuota y menos cuotas'
spec: debt/amortization
related_specs: []
requirement: 'Pago extraordinario reduciendo el plazo'
scenario: 'Prepago de 3000.00 reduciendo el plazo'
requirement_status: provisional
fr: ['FR-DEBT-008']
nfr: []
invariants: ['INV-017']
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['amortization', 'prepayment']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo francés de 12000.00 BOB al 12.00 % a 12 cuotas de 1066.19 BOB tiene pagadas las cuotas 1 a 3 (principal pendiente 9132.95 BOB) y el 2027-01-15 se registra un pago extraordinario de 3000.00 BOB reduciendo el plazo'
expected_result:
  - 'La versión 2 tiene las cuotas 4 a 9 de 1066.19 BOB con la cuota 9 del 2027-07-15 de 1017.22 BOB y la suma de su principal es 6132.95 BOB'
  - 'El interés restante baja de 462.71 BOB a 215.22 BOB (ahorro 247.49 BOB)'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-AMORT-031 — Prepago reduciendo el plazo: misma cuota y menos cuotas

## Intención

FR-DEBT-008: reducir plazo y su ahorro de interés.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo francés de 12000.00 BOB al 12.00 % a 12 cuotas de 1066.19 BOB tiene pagadas las cuotas 1 a 3 (principal pendiente 9132.95 BOB) y el 2027-01-15 se registra un pago extraordinario de 3000.00 BOB reduciendo el plazo
Entonces la versión 2 tiene las cuotas 4 a 9 de 1066.19 BOB con la cuota 9 del 2027-07-15 de 1017.22 BOB y la suma de su principal es 6132.95 BOB
  Y el interés restante baja de 462.71 BOB a 215.22 BOB (ahorro 247.49 BOB)
```

## Notas

- Change: `add-loan-amortization-advanced` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
