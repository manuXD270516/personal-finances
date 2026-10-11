---
id: TC-DEBT-LOAN-026
title: 'Anular el pago devuelve la ocurrencia a atrasada'
spec: debt/loans
related_specs: ['commitments/recurrence-engine']
requirement: 'Pago registrado resuelve la ocurrencia de la cuota'
scenario: 'Anular el pago devuelve la ocurrencia'
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
tags: ['loans', 'commitments', 'void']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Hoy es 2026-11-20 y el EDITOR anula el pago de 2342.02 BOB de la cuota 1 del 2026-11-15'
expected_result:
  - 'La ocurrencia de la cuota 1 vuelve a atrasada esperando 2342.02 BOB y sin transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-026 — Anular el pago devuelve la ocurrencia a atrasada

## Intención

La ocurrencia debe reflejar que la cuota volvió a deberse.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando hoy es 2026-11-20 y el EDITOR anula el pago de 2342.02 BOB de la cuota 1 del 2026-11-15
Entonces la ocurrencia de la cuota 1 vuelve a atrasada esperando 2342.02 BOB y sin transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
