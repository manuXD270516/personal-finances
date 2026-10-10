---
id: TC-DEBT-LOAN-005
title: 'Una cuenta que no es loan no puede respaldar un préstamo'
spec: debt/loans
related_specs: []
requirement: 'Cuenta del préstamo y cuenta destino'
scenario: 'Cuenta bancaria como cuenta del préstamo'
requirement_status: provisional
fr: ['FR-DEBT-001']
nfr: []
invariants: ['INV-030']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'validation']
error_code: LOAN_ACCOUNT_INVALID
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un préstamo indicando "Banco BOB" (`bank`) como cuenta del préstamo'
expected_result:
  - 'Se rechaza con `LOAN_ACCOUNT_INVALID` y no se crea el préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-005 — Una cuenta que no es loan no puede respaldar un préstamo

## Intención

INV-030: el préstamo opera sobre una cuenta de pasivo; una cuenta de activo invertiría los signos del desembolso.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un préstamo indicando "Banco BOB" (`bank`) como cuenta del préstamo
Entonces se rechaza con `LOAN_ACCOUNT_INVALID` y no se crea el préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
