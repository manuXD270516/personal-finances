---
id: TC-DEBT-LOAN-004
title: 'La cuenta loan se crea en el mismo acto del registro'
spec: debt/loans
related_specs: ['accounts/account-management']
requirement: 'Cuenta del préstamo y cuenta destino'
scenario: 'Cuenta del préstamo creada en el mismo acto'
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
  - packages/contexts/accounts/src/application/account-provisioning.adapter.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'accounts']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra el préstamo de 50000.00 BOB pidiendo crear la cuenta "Préstamo vehicular"'
expected_result:
  - 'Existe la cuenta "Préstamo vehicular" de tipo `loan`, naturaleza pasivo, en BOB, con saldo 0.00 BOB, vinculada al préstamo en borrador'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-004 — La cuenta loan se crea en el mismo acto del registro

## Intención

Crear la cuenta y el préstamo en una sola unidad de trabajo evita borradores huérfanos (design decisión 7).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra el préstamo de 50000.00 BOB pidiendo crear la cuenta "Préstamo vehicular"
Entonces existe la cuenta "Préstamo vehicular" de tipo `loan`, naturaleza pasivo, en BOB, con saldo 0.00 BOB, vinculada al préstamo en borrador
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
