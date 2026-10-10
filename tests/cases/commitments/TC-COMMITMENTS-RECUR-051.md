---
id: TC-COMMITMENTS-RECUR-051
title: 'Reprocesar la creación automática de una ocurrencia no crea una segunda transacción'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Modo creación automática'
scenario: 'Worker re-ejecutado no duplica la transacción'
requirement_status: provisional
fr: ['FR-COMMITMENTS-007']
nfr: []
invariants: ['INV-013']
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'auto-create', 'idempotency']
error_code: null
preconditions:
  - 'Internet AUTO_CREATE; hoy 2026-10-20'
input: {}
steps:
  - 'Ejecutar el job dos veces, y además en paralelo'
expected_result:
  - 'Una sola transacción con externalRef commitments.occurrence/<occurrenceId>'
  - 'Un solo RecurringOccurrenceMaterialized.v1'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-051 — Reprocesar la creación automática de una ocurrencia no crea una segunda transacción

## Intención

Idempotencia de la materialización (estado + índice único parcial en txn.transaction).

## Escenario

```gherkin
Dado la ocurrencia del 2026-10-20 del "Internet" en creación automática
Cuando el worker la procesa dos veces
Entonces existe una sola transacción para esa ocurrencia
```

## Notas

