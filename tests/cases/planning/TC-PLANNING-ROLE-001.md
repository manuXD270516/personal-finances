---
id: TC-PLANNING-ROLE-001
title: Solo EDITOR u OWNER ejecutan comandos de periodos; el no miembro no ve periodos
spec: planning/financial-periods
related_specs: []
requirement: Autorización de comandos de periodos
scenario: VIEWER intenta activar
requirement_status: confirmed
fr:
  - FR-PLANNING-001
nfr:
  - NFR-SEC-003
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/periods.api.test.ts
  - apps/web/src/ui/planning/planning.test.tsx
status: automated
regression_suite: false
phase: 2
tags:
  - financial-periods
  - authorization
error_code: INSUFFICIENT_ROLE
preconditions:
  - '"2026-11" iniciado y en draft'
  - Usuarios VIEWER del workspace y U3 no miembro
input:
  - actor: VIEWER
    command: activate
  - actor: U3
    query: listPeriods
steps:
  - "VIEWER: POST /periods/{id}/activate"
  - "U3: GET /periods"
expected_result:
  - VIEWER recibe 403 INSUFFICIENT_ROLE y "2026-11" sigue en draft
  - U3 recibe 403 WORKSPACE_ACCESS_DENIED sin datos
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ROLE-001 — Solo EDITOR u OWNER ejecutan comandos de periodos; el no miembro no ve periodos

## Intención

RBAC por workspace (NFR-SEC-003) en el nuevo recurso.

## Escenario

```gherkin
Dado un VIEWER del workspace
Cuando intenta activar "2026-11"
Entonces la respuesta es 403 con código "INSUFFICIENT_ROLE"
```

## Notas

- Cubre "No miembro consulta periodos".
