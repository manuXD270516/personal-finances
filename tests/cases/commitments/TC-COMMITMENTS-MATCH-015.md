---
id: TC-COMMITMENTS-MATCH-015
title: 'Un VIEWER puede ver sugerencias pero no confirmarlas ni descartarlas'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Confirmar una sugerencia'
scenario: 'VIEWER no confirma'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/match-suggestions.api.test.ts
  - apps/web/src/ui/recurring/matching.test.tsx
status: automated
regression_suite: false
phase: 3
tags: ['matching', 'authz']
error_code: INSUFFICIENT_ROLE
preconditions:
  - 'Usuario VIEWER; sugerencia PROPOSED'
input: {}
steps:
  - 'GET W/recurring/match-suggestions'
  - 'POST …/confirm'
  - 'POST …/dismiss'
expected_result:
  - '200 con la sugerencia'
  - '403 INSUFFICIENT_ROLE en ambas acciones; la sugerencia sigue PROPOSED'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-MATCH-015 — Un VIEWER puede ver sugerencias pero no confirmarlas ni descartarlas

## Intención

security/access-control.

## Escenario

```gherkin
Dado un VIEWER
Cuando confirma una sugerencia propuesta
Entonces se rechaza con INSUFFICIENT_ROLE
```

## Notas

