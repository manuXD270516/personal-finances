---
id: TC-DEBT-LOAN-043
title: 'Una cuenta loan solo respalda un préstamo no cancelado'
spec: debt/loans
related_specs: []
requirement: 'Cuenta del préstamo y cuenta destino'
scenario: 'Cuenta ya usada por otro préstamo'
requirement_status: confirmed
fr: ['FR-DEBT-001']
nfr: []
invariants: ['INV-030']
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - packages/contexts/debt/test/integration/pg-debt.int.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'validation']
error_code: LOAN_ACCOUNT_IN_USE
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un segundo préstamo con la cuenta "Préstamo vehicular" que ya respalda un préstamo activo'
expected_result:
  - 'Se rechaza con `LOAN_ACCOUNT_IN_USE` y no se crea el préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-043 — Una cuenta loan solo respalda un préstamo no cancelado

## Intención

Dos préstamos sobre la misma cuenta harían imposible conciliar saldo y cronograma.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un segundo préstamo con la cuenta "Préstamo vehicular" que ya respalda un préstamo activo
Entonces se rechaza con `LOAN_ACCOUNT_IN_USE` y no se crea el préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
