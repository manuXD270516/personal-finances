---
id: TC-COMMITMENTS-MATCH-016
title: 'El hecho de sugerencia cumple su JSON Schema con montos como texto decimal'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Sugerencia de coincidencia para una transacción registrada'
scenario: 'Gasto manual sugerido para el internet'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: ['INV-001']
priority: medium
type: integration
level: event-contract
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['matching', 'events']
error_code: null
preconditions:
  - 'Schema contracts/events/commitments/OccurrenceMatchSuggested.v1.schema.json'
input: {}
steps:
  - 'Crear la sugerencia del Internet'
  - 'Validar el evento del outbox'
expected_result:
  - 'OccurrenceMatchSuggested.v1 válido con score "85.00", confidence HIGH, amountDelta {amount: "0.00", currency: "BOB"}, dateDeltaDays 1'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-016 — El hecho de sugerencia cumple su JSON Schema con montos como texto decimal

## Intención

Contrato del evento para Reporting (Q9) y Notify.

## Escenario

```gherkin
Cuando se crea la sugerencia del gasto del 2026-10-19 con el "Internet"
Entonces se publica un hecho de sugerencia válido contra su schema
```

## Notas

