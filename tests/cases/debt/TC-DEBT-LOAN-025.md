---
id: TC-DEBT-LOAN-025
title: 'Un pago de dos cuotas resuelve ambas ocurrencias con la misma transacción'
spec: debt/loans
related_specs: ['commitments/recurrence-engine']
requirement: 'Pago registrado resuelve la ocurrencia de la cuota'
scenario: 'Un pago resuelve dos ocurrencias'
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
  - packages/contexts/commitments/test/integration/pg-loan-payment.int.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'commitments']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un pago de 4684.04 BOB que paga las cuotas 1 y 2'
expected_result:
  - 'Las ocurrencias del 2026-11-15 y del 2026-12-15 quedan resueltas por la misma transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-025 — Un pago de dos cuotas resuelve ambas ocurrencias con la misma transacción

## Intención

La resolución 1:N es exclusiva de los compromisos administrados por deudas (N5).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un pago de 4684.04 BOB que paga las cuotas 1 y 2
Entonces las ocurrencias del 2026-11-15 y del 2026-12-15 quedan resueltas por la misma transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
- Cubre también el scenario "Dos cuotas con un solo pago" de commitments/recurrence-engine.
