---
id: TC-COMMITMENTS-MATCH-008
title: 'Un par descartado nunca vuelve a sugerirse aunque la transacción se edite'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Descartar una sugerencia'
scenario: 'Descartada no vuelve'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['matching', 'dismiss']
error_code: null
preconditions:
  - 'Sugerencia PROPOSED entre el gasto de 199.00 BOB del 2026-10-19 y el Internet'
input: {}
steps:
  - 'POST …/dismiss'
  - 'Editar la descripción del gasto (TransactionUpdated.v1)'
  - 'Reentregar TransactionCreated.v1'
expected_result:
  - 'Sugerencia DISMISSED, auditada'
  - 'Ninguna sugerencia nueva para el par'
  - 'Ocurrencia sin resolver'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-008 — Un par descartado nunca vuelve a sugerirse aunque la transacción se edite

## Intención

El usuario no ve dos veces la misma sugerencia rechazada.

## Escenario

```gherkin
Dado la sugerencia del gasto del 2026-10-19 con el "Internet"
Cuando el EDITOR la descarta y luego edita la descripción del gasto
Entonces no se crea una nueva sugerencia para ese par
```

## Notas

