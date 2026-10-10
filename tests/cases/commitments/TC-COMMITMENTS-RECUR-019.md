---
id: TC-COMMITMENTS-RECUR-019
title: 'La creación automática crea un gasto pendiente en la fecha de vencimiento y materializa la ocurrencia'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Modo creación automática'
scenario: 'Internet creado como pendiente'
requirement_status: provisional
fr: ['FR-COMMITMENTS-007']
nfr: []
invariants: ['INV-013', 'INV-029']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'auto-create']
error_code: null
preconditions:
  - 'Internet FIXED 199.00 BOB, AUTO_CREATE con autoCreateStatus PENDING'
  - 'Hoy 2026-10-20; periodo 2026-10 activo'
input: {}
steps:
  - 'Ejecutar el job'
expected_result:
  - 'Gasto PENDING de 199.00 BOB, fecha 2026-10-20, source RECURRING, externalRef commitments.occurrence/<occurrenceId>'
  - 'Ocurrencia MATERIALIZED con ese transactionId'
  - 'TransactionCreated.v1 con origin.refId = occurrenceId y RecurringOccurrenceMaterialized.v1 mode CREATED en el mismo commit'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-019 — La creación automática crea un gasto pendiente en la fecha de vencimiento y materializa la ocurrencia

## Intención

FR-COMMITMENTS-007: materialización atómica vía el puerto de Transactions.

## Escenario

```gherkin
Dado el "Internet" de 199.00 BOB en creación automática pendiente
Cuando hoy es su vencimiento 2026-10-20
Entonces se crea un gasto PENDING de 199.00 BOB con fecha 2026-10-20
  Y la ocurrencia queda materializada
```

## Notas

- Si Transactions falla, nada se persiste (misma UoW).
