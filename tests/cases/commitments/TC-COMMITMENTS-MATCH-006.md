---
id: TC-COMMITMENTS-MATCH-006
title: 'Confirmar una sugerencia vincula por sugerencia y saca la ocurrencia del comprometido'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Confirmar una sugerencia'
scenario: 'Confirmar la sugerencia del internet'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-010', 'FR-COMMITMENTS-008']
nfr: []
invariants: ['INV-029']
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/match-suggestions.api.test.ts
  - packages/contexts/commitments/src/application/matching.service.test.ts
  - packages/contexts/commitments/src/application/matching.subscriptions.test.ts
  - packages/contexts/commitments/src/domain/matching/match-suggestion.test.ts
  - tests/e2e/specs/commitment-matching.spec.ts
status: automated
regression_suite: false
phase: 3
tags: ['matching', 'confirm']
error_code: null
preconditions:
  - 'Sugerencia PROPOSED entre el gasto de 199.00 BOB del 2026-10-19 y la ocurrencia del Internet 2026-10-20'
  - 'Otra sugerencia PROPOSED del mismo gasto con "Internet oficina"'
input: {}
steps:
  - 'POST W/recurring/match-suggestions/{id}/confirm con Idempotency-Key'
  - 'GET W/recurring/committed?periodId=2026-10'
expected_result:
  - 'Ocurrencia MATCHED con matchedBy SUGGESTION'
  - 'Sugerencia CONFIRMED; la de Internet oficina EXPIRED (SUPERSEDED)'
  - 'RecurringOccurrenceMaterialized.v1 mode MATCHED matchedBy SUGGESTION'
  - 'El comprometido de octubre ya no incluye 199.00 BOB del Internet'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-MATCH-006 — Confirmar una sugerencia vincula por sugerencia y saca la ocurrencia del comprometido

## Intención

La confirmación reutiliza el vínculo manual en una sola UoW.

## Escenario

```gherkin
Dado la sugerencia entre el gasto del 2026-10-19 y el "Internet" del 2026-10-20
Cuando el EDITOR la confirma
Entonces la ocurrencia queda vinculada por sugerencia
  Y sale del total comprometido de octubre
```

## Notas

