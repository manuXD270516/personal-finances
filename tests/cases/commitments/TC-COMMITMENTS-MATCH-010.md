---
id: TC-COMMITMENTS-MATCH-010
title: 'Anular o editar fuera de tolerancia la transacción expira su sugerencia'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Expiración de sugerencias'
scenario: 'Transacción anulada expira la sugerencia'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['matching', 'expire']
error_code: null
preconditions:
  - 'Sugerencias PROPOSED de dos gastos de 199.00 BOB con el Internet (uno por caso)'
input:
  a: 'anular el primer gasto'
  b: 'corregir el segundo gasto a 250.00 BOB'
steps:
  - 'Procesar TransactionVoided.v1'
  - 'Procesar TransactionUpdated.v1 con changedFields [amount]'
expected_result:
  - 'a: EXPIRED (TRANSACTION_VOIDED)'
  - 'b: EXPIRED (INCOMPATIBLE); al volver a 199.00 BOB pasa a PROPOSED (REPROPOSE)'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-010 — Anular o editar fuera de tolerancia la transacción expira su sugerencia

## Intención

Las sugerencias reflejan el estado vigente de la transacción.

## Escenario

```gherkin
Dado una sugerencia propuesta del gasto de 199.00 BOB con el "Internet"
Cuando el usuario anula el gasto
Entonces la sugerencia queda expirada por anulación
```

## Notas

- Cubre el scenario "Monto editado fuera de tolerancia"; depende de la pregunta abierta 7.
