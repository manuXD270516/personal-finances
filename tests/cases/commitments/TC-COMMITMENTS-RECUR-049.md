---
id: TC-COMMITMENTS-RECUR-049
title: 'Una transacción ya vinculada a otra ocurrencia no puede vincularse de nuevo'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Marcar pagada vinculando una transacción existente'
scenario: 'Transacción ya vinculada'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'link']
error_code: TRANSACTION_ALREADY_LINKED
preconditions:
  - 'Gasto de 199.00 BOB vinculado a la ocurrencia de octubre del Internet'
input: {}
steps:
  - 'Vincular la ocurrencia de noviembre con el mismo gasto'
expected_result:
  - '409 TRANSACTION_ALREADY_LINKED'
  - 'Índice único parcial (workspace_id, transaction_id) respetado'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-049 — Una transacción ya vinculada a otra ocurrencia no puede vincularse de nuevo

## Intención

Una transacción resuelve a lo sumo una ocurrencia.

## Escenario

```gherkin
Dado el gasto vinculado a la ocurrencia de octubre
Cuando el usuario lo vincula a la de noviembre
Entonces se rechaza con TRANSACTION_ALREADY_LINKED
```

## Notas

