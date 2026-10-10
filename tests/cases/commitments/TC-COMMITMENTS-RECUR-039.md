---
id: TC-COMMITMENTS-RECUR-039
title: 'Un VIEWER no puede aprobar ocurrencias pero sí consultar el comprometido'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Permisos y auditoría de los compromisos'
scenario: 'VIEWER no aprueba'
requirement_status: provisional
fr: ['FR-COMMITMENTS-008', 'FR-AUDIT-001']
nfr: []
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'authz']
error_code: INSUFFICIENT_ROLE
preconditions:
  - 'Usuario VIEWER del workspace'
  - 'Ocurrencia DUE del Alquiler 2026-11-05'
input: {}
steps:
  - 'POST …/materialize como VIEWER'
  - 'GET W/recurring/committed como VIEWER'
expected_result:
  - '403 INSUFFICIENT_ROLE sin transacción'
  - '200 con el comprometido'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-039 — Un VIEWER no puede aprobar ocurrencias pero sí consultar el comprometido

## Intención

security/access-control: lecturas VIEWER+, escrituras EDITOR+.

## Escenario

```gherkin
Dado un VIEWER
Cuando aprueba la ocurrencia del 2026-11-05 del "Alquiler"
Entonces se rechaza con INSUFFICIENT_ROLE
```

## Notas

- Otro workspace ⇒ 403 WORKSPACE_ACCESS_DENIED.
