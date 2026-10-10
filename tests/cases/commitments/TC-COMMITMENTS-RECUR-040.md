---
id: TC-COMMITMENTS-RECUR-040
title: 'Los hechos de commitments cumplen su JSON Schema y llevan montos como texto decimal'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Hechos publicados de los compromisos'
scenario: 'Materialización publicada'
requirement_status: provisional
fr: ['FR-COMMITMENTS-006', 'FR-COMMITMENTS-008']
nfr: []
invariants: ['INV-001']
priority: high
type: integration
level: event-contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'events']
error_code: null
preconditions:
  - 'Schemas contracts/events/commitments/*.v1.schema.json'
input:
  amount: '3500.00 BOB'
steps:
  - 'Aprobar la ocurrencia del 2026-11-05 del Alquiler'
  - 'Validar los eventos del outbox contra sus schemas'
expected_result:
  - 'Un RecurringOccurrenceMaterialized.v1 con occurrenceId, transactionId, mode CREATED y amount {amount: "3500.00", currency: "BOB"}'
  - 'OccurrencesGenerated, RecurringOccurrenceDue, RecurringOccurrenceChanged y RecurringDefinitionChanged válidos contra sus schemas'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-040 — Los hechos de commitments cumplen su JSON Schema y llevan montos como texto decimal

## Intención

Contrato de eventos para Reporting, Notify, Subscriptions y Matching.

## Escenario

```gherkin
Cuando el EDITOR aprueba la ocurrencia del 2026-11-05 por 3500.00 BOB
Entonces se publica un único hecho de ocurrencia materializada
  Y el monto viaja como "3500.00" con moneda BOB
```

## Notas

