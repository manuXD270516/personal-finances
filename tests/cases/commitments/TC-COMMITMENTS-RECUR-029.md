---
id: TC-COMMITMENTS-RECUR-029
title: 'Marcar pagada vinculando una transacción existente la resuelve sin crear transacciones'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Marcar pagada vinculando una transacción existente'
scenario: 'Internet pagado a mano'
requirement_status: provisional
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'link']
error_code: null
preconditions:
  - 'Gasto manual de 199.00 BOB en Banco BOB del 2026-10-19'
  - 'Ocurrencia DUE del Internet 2026-10-20 (Banco BOB, BOB)'
input: {}
steps:
  - 'Vincular la ocurrencia con el gasto'
expected_result:
  - 'Ocurrencia MATCHED con matchedBy USER_LINK y ese transactionId'
  - 'Ninguna transacción nueva'
  - 'RecurringOccurrenceMaterialized.v1 mode MATCHED'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-029 — Marcar pagada vinculando una transacción existente la resuelve sin crear transacciones

## Intención

FR-COMMITMENTS-008: matching manual.

## Escenario

```gherkin
Dado un gasto manual de 199.00 BOB del 2026-10-19 en "Banco BOB"
Cuando el usuario vincula con él la ocurrencia del 2026-10-20 del "Internet"
Entonces la ocurrencia queda vinculada y no se crea ninguna transacción
```

## Notas

