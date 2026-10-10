---
id: TC-COMMITMENTS-RECUR-031
title: 'Anular la transacción vinculada libera la ocurrencia una sola vez aunque el hecho se repita'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Liberar la ocurrencia al anular su transacción'
scenario: 'Gasto anulado libera la ocurrencia'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: ['INV-028']
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
  - tests/e2e/specs/recurring.spec.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'release', 'consumer']
error_code: null
preconditions:
  - 'Ocurrencia del Internet 2026-10-20 MATCHED con un gasto de 199.00 BOB'
  - 'Hoy 2026-10-22'
input: {}
steps:
  - 'Anular el gasto'
  - 'Entregar TransactionVoided.v1 dos veces al consumidor commitments.transaction-voided (eventId distinto la segunda)'
expected_result:
  - 'Ocurrencia OVERDUE sin transactionId'
  - 'Una sola transición RELEASE y un solo RecurringOccurrenceChanged.v1'
  - 'Puede aprobarse o vincularse de nuevo'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-031 — Anular la transacción vinculada libera la ocurrencia una sola vez aunque el hecho se repita

## Intención

docs/05 §2.7: TransactionVoided libera la ocurrencia.

## Escenario

```gherkin
Dado hoy 2026-10-22 y el gasto vinculado a la ocurrencia del 2026-10-20
Cuando el usuario anula el gasto
Entonces la ocurrencia vuelve a atrasada sin transacción
```

## Notas

