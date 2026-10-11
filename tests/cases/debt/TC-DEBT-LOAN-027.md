---
id: TC-DEBT-LOAN-027
title: 'El préstamo queda saldado cuando el principal pendiente llega a cero'
spec: debt/loans
related_specs: []
requirement: 'Préstamo saldado y préstamo cancelado'
scenario: 'Préstamo saldado con la última cuota'
requirement_status: confirmed
fr: ['FR-DEBT-001', 'FR-DEBT-011']
nfr: []
invariants: ['INV-017']
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - packages/contexts/debt/src/domain/loan.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'paid-off']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 1000.00 BOB al 1 % mensual a 3 cuotas tiene pagadas las cuotas de 340.02 BOB y 340.02 BOB y el EDITOR paga la cuota 3 de 340.03 BOB'
expected_result:
  - 'La cuenta del préstamo adeuda 0.00 BOB, el préstamo queda saldado y su compromiso terminado'
  - 'Un nuevo pago de 10.00 BOB se rechaza con `LOAN_NOT_ACTIVE`'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-027 — El préstamo queda saldado cuando el principal pendiente llega a cero

## Intención

El estado saldado cierra el compromiso y evita pagos posteriores.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 1000.00 BOB al 1 % mensual a 3 cuotas tiene pagadas las cuotas de 340.02 BOB y 340.02 BOB y el EDITOR paga la cuota 3 de 340.03 BOB
Entonces la cuenta del préstamo adeuda 0.00 BOB, el préstamo queda saldado y su compromiso terminado
  Y un nuevo pago de 10.00 BOB se rechaza con `LOAN_NOT_ACTIVE`
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
