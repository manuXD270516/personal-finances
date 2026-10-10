---
id: TC-COMMITMENTS-RECUR-034
title: 'Cambiar esta y las siguientes crea la versión 2 sin alterar ocurrencias ni transacciones resueltas'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cambiar esta y las siguientes'
scenario: 'Aumento del alquiler desde enero'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-009']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - apps/web/src/ui/recurring/recurring.test.tsx
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
  - tests/e2e/specs/recurring.spec.ts
status: automated
regression_suite: true
phase: 3
tags: ['recurrence', 'revision']
error_code: null
preconditions:
  - 'Alquiler FIXED 3500.00 BOB v1 con ocurrencias oct-dic 2026 MATERIALIZED y 2027-01-05 SCHEDULED'
input:
  effectiveFrom: '2027-01-05'
  amount: '3800.00 BOB'
steps:
  - 'POST …/revisions'
expected_result:
  - 'Definición en versión 2'
  - '2027-01-05 espera 3800.00 BOB con definitionVersionNo 2'
  - 'Ocurrencias y transacciones de oct-dic siguen en 3500.00 BOB con versión 1'
  - 'RecurringDefinitionChanged.v1 REVISE con rewrittenOccurrenceIds'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-034 — Cambiar esta y las siguientes crea la versión 2 sin alterar ocurrencias ni transacciones resueltas

## Intención

FR-COMMITMENTS-009: versionado sin reescribir historia.

## Escenario

```gherkin
Dado las ocurrencias de octubre a diciembre materializadas en 3500.00 BOB
Cuando el EDITOR revisa el "Alquiler" a 3800.00 BOB desde 2027-01-05
Entonces la ocurrencia del 2027-01-05 espera 3800.00 BOB con versión 2
  Y las de octubre a diciembre no cambian
```

## Notas

- Las versiones son append-only (forbid_mutation).
