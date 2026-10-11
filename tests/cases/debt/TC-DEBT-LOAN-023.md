---
id: TC-DEBT-LOAN-023
title: 'El compromiso de cuotas no se opera desde recurrentes'
spec: debt/loans
related_specs: ['commitments/recurrence-engine']
requirement: 'Cuotas como compromisos recurrentes'
scenario: 'Pausar el compromiso del préstamo'
requirement_status: confirmed
fr: ['FR-DEBT-011']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - packages/contexts/commitments/src/application/loan-payment.service.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'commitments']
error_code: RECURRING_MANAGED_EXTERNALLY
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR intenta pausar desde recurrentes el compromiso del "Préstamo vehicular"'
expected_result:
  - 'Se rechaza con `RECURRING_MANAGED_EXTERNALLY` y el compromiso sigue activo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-023 — El compromiso de cuotas no se opera desde recurrentes

## Intención

El compromiso administrado por el préstamo no puede divergir del cronograma.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR intenta pausar desde recurrentes el compromiso del "Préstamo vehicular"
Entonces se rechaza con `RECURRING_MANAGED_EXTERNALLY` y el compromiso sigue activo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
