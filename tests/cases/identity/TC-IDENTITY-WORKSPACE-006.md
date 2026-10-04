---
id: TC-IDENTITY-WORKSPACE-006
title: El listado de workspaces muestra solo las membresías activas del usuario
spec: identity/workspace-membership
related_specs:
- security/access-control
requirement: Listado de workspaces del usuario
scenario: null
requirement_status: confirmed
fr:
- FR-IDENTITY-007
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/workspace-base-currency.api.test.ts
- apps/api/test/api/identity.api.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- workspace
- membership
error_code: null
preconditions:
- 'Minimal Seed: owner es OWNER de W1 y W2; outsider es OWNER solo de W2'
input:
- usuario: owner
- usuario: outsider
steps:
- GET /api/v1/workspaces como cada usuario
expected_result:
- 'owner: W1 Personal Demo y W2 Other Demo, ambos con role OWNER; page.hasMore false'
- 'outsider: solo W2 Other Demo'
created: 2026-10-02
updated: 2026-10-04
---

# TC-IDENTITY-WORKSPACE-006 — El listado de workspaces muestra solo las membresías activas del usuario

## Intención

El selector de workspace no debe ofrecer workspaces ajenos (FR-IDENTITY-007).

## Escenario

```gherkin
Dado que "outsider" es miembro solo de "W2 Other Demo"
Cuando lista sus workspaces
Entonces la respuesta contiene solo "W2 Other Demo"
```

## Notas

- Requirement Should.
