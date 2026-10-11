---
id: TC-DEBT-LOAN-037
title: 'Aprobar una ocurrencia de cuota desde recurrentes se rechaza'
spec: commitments/recurrence-engine
related_specs: ['debt/loans']
requirement: 'Cuotas de préstamo administradas por el contexto de deudas'
scenario: 'Aprobar una cuota desde recurrentes'
requirement_status: confirmed
fr: ['FR-DEBT-011', 'FR-COMMITMENTS-008']
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
tags: ['commitments', 'loans']
error_code: RECURRING_MANAGED_EXTERNALLY
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR aprueba desde recurrentes la ocurrencia del 2026-11-15 del "Préstamo vehicular"'
expected_result:
  - 'Se rechaza con `RECURRING_MANAGED_EXTERNALLY` indicando el préstamo que la administra y no se crea ninguna transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-037 — Aprobar una ocurrencia de cuota desde recurrentes se rechaza

## Intención

El motor nunca crea transacciones de préstamo; el pago se registra en el préstamo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR aprueba desde recurrentes la ocurrencia del 2026-11-15 del "Préstamo vehicular"
Entonces se rechaza con `RECURRING_MANAGED_EXTERNALLY` indicando el préstamo que la administra y no se crea ninguna transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
