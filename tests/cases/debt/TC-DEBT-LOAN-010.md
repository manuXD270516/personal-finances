---
id: TC-DEBT-LOAN-010
title: 'Un préstamo en curso entra activo con saldo inicial y cronograma desde la cuota 7'
spec: debt/loans
related_specs: ['accounts/account-management']
requirement: 'Préstamo preexistente con saldo pendiente'
scenario: 'Préstamo en curso desde la cuota 7'
requirement_status: provisional
fr: ['FR-DEBT-002']
nfr: []
invariants: ['INV-017']
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'existing']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra el préstamo en curso "Préstamo personal" con saldo pendiente 30000.00 BOB al 2026-10-15, 11.50 % anual, 30/360, mensual, próxima cuota número 7 el 2026-11-15 y 18 cuotas restantes, creando su cuenta'
expected_result:
  - 'La cuenta "Préstamo personal" adeuda 30000.00 BOB por un asiento de apertura fechado 2026-10-15'
  - 'El préstamo queda activo con las cuotas 7 a 24 de 1822.50 BOB (la 24 de 1822.53 BOB) cuyo principal suma 30000.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-010 — Un préstamo en curso entra activo con saldo inicial y cronograma desde la cuota 7

## Intención

FR-DEBT-002: el owner ya tiene préstamos en curso; deben entrar sin desembolso, con su saldo pendiente y numeración continua.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra el préstamo en curso "Préstamo personal" con saldo pendiente 30000.00 BOB al 2026-10-15, 11.50 % anual, 30/360, mensual, próxima cuota número 7 el 2026-11-15 y 18 cuotas restantes, creando su cuenta
Entonces la cuenta "Préstamo personal" adeuda 30000.00 BOB por un asiento de apertura fechado 2026-10-15
  Y el préstamo queda activo con las cuotas 7 a 24 de 1822.50 BOB (la 24 de 1822.53 BOB) cuyo principal suma 30000.00 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
