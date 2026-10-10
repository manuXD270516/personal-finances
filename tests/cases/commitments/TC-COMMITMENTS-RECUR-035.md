---
id: TC-COMMITMENTS-RECUR-035
title: 'Una revisión con fecha efectiva anterior a una ocurrencia resuelta se rechaza'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Cambiar esta y las siguientes'
scenario: 'Fecha efectiva anterior a una resuelta'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-009']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/generation.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'revision']
error_code: RECURRING_REVISION_DATE_INVALID
preconditions:
  - 'Alquiler con ocurrencia 2026-11-05 MATERIALIZED'
input:
  effectiveFrom: '2026-10-05'
steps:
  - 'POST …/revisions'
expected_result:
  - '422 RECURRING_REVISION_DATE_INVALID'
  - 'La definición sigue en su versión vigente'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-035 — Una revisión con fecha efectiva anterior a una ocurrencia resuelta se rechaza

## Intención

Las ocurrencias resueltas nunca se reescriben.

## Escenario

```gherkin
Dado la ocurrencia del 2026-11-05 materializada
Cuando el EDITOR revisa desde 2026-10-05
Entonces se rechaza con RECURRING_REVISION_DATE_INVALID
```

## Notas

