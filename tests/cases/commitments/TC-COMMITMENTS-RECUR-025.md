---
id: TC-COMMITMENTS-RECUR-025
title: 'Aprobar dos veces la misma ocurrencia se rechaza y deja una sola transacción'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Aprobar una ocurrencia crea su transacción'
scenario: 'Aprobar dos veces'
requirement_status: provisional
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: ['INV-013']
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'materialize']
error_code: OCCURRENCE_ALREADY_MATERIALIZED
preconditions:
  - 'Ocurrencia de la Luz del 2026-10-25 MATERIALIZED'
input:
  idempotencyKey: 'distinta a la primera'
steps:
  - 'POST …/materialize con otra Idempotency-Key'
expected_result:
  - '409 OCCURRENCE_ALREADY_MATERIALIZED'
  - 'Una sola transacción con externalRef de la ocurrencia'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-025 — Aprobar dos veces la misma ocurrencia se rechaza y deja una sola transacción

## Intención

Una ocurrencia materializada referencia exactamente una transacción (docs/04 §3.7).

## Escenario

```gherkin
Dado la ocurrencia ya materializada del 2026-10-25
Cuando el EDITOR la aprueba otra vez
Entonces se rechaza con OCCURRENCE_ALREADY_MATERIALIZED
```

## Notas

- El índice único parcial de txn.transaction es la defensa en profundidad.
