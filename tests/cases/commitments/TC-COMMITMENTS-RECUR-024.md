---
id: TC-COMMITMENTS-RECUR-024
title: 'Aprobar una ocurrencia variable sin monto se rechaza sin crear transacción'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Aprobar una ocurrencia crea su transacción'
scenario: 'Variable sin monto'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-008']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/definition.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'materialize']
error_code: OCCURRENCE_AMOUNT_REQUIRED
preconditions:
  - 'Compra mayorista VARIABLE con ocurrencia DUE'
input:
  amount: '(ausente)'
  outOfRange: 'Gimnasio MIN_MAX 100.00..180.00 aprobado con 200.00 BOB'
steps:
  - 'Aprobar sin monto'
  - 'Aprobar el Gimnasio con 200.00 BOB'
expected_result:
  - 'OCCURRENCE_AMOUNT_REQUIRED'
  - 'RECURRING_INVALID_AMOUNT'
  - 'Ninguna transacción creada'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-024 — Aprobar una ocurrencia variable sin monto se rechaza sin crear transacción

## Intención

FR-COMMITMENTS-004: variable requiere monto al confirmar.

## Escenario

```gherkin
Dado una ocurrencia de "Compra mayorista" VARIABLE
Cuando el EDITOR la aprueba sin monto
Entonces se rechaza con OCCURRENCE_AMOUNT_REQUIRED
```

## Notas

