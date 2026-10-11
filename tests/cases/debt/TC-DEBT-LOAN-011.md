---
id: TC-DEBT-LOAN-011
title: 'El saldo de la cuenta distinto del pendiente declarado se rechaza'
spec: debt/loans
related_specs: []
requirement: 'Préstamo preexistente con saldo pendiente'
scenario: 'Saldo de la cuenta distinto del pendiente'
requirement_status: confirmed
fr: ['FR-DEBT-002']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'existing', 'validation']
error_code: LOAN_BALANCE_MISMATCH
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'La cuenta "Préstamo personal" ya adeuda 29500.00 BOB al 2026-10-15 y el EDITOR registra el préstamo en curso con saldo pendiente 30000.00 BOB'
expected_result:
  - 'Se rechaza con `LOAN_BALANCE_MISMATCH` informando 29500.00 BOB en la cuenta y 30000.00 BOB declarados, y no se crea el préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-011 — El saldo de la cuenta distinto del pendiente declarado se rechaza

## Intención

Evita que préstamo y cuenta nazcan desincronizados.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando la cuenta "Préstamo personal" ya adeuda 29500.00 BOB al 2026-10-15 y el EDITOR registra el préstamo en curso con saldo pendiente 30000.00 BOB
Entonces se rechaza con `LOAN_BALANCE_MISMATCH` informando 29500.00 BOB en la cuenta y 30000.00 BOB declarados, y no se crea el préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
