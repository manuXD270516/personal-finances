---
id: TC-AUDIT-ACCESS-001
title: "Solo OWNER y EDITOR pueden leer la auditoría; VIEWER recibe INSUFFICIENT_ROLE"
spec: audit/audit-trail
related_specs: ["security/access-control"]
requirement: "Lectura de auditoría restringida por rol"
scenario: "VIEWER consulta la auditoría"
requirement_status: confirmed
fr: [FR-AUDIT-004]
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/audit.api.test.ts
  - tests/e2e/specs/audit.spec.ts
status: automated
regression_suite: false
phase: 1
tags: ["audit", "rbac"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Minimal Seed: owner@, editor@ y viewer@demo.pfos.test en W1; Bank A con historial"
input:
  request: "GET /workspaces/W1/audit-log?aggregateType=Account&aggregateId=<Bank A>"
steps:
  - "Ejecutar la consulta como OWNER, EDITOR y VIEWER"
expected_result:
  - "OWNER y EDITOR reciben 200 con los registros de Bank A"
  - "VIEWER recibe 403 problem+json con code INSUFFICIENT_ROLE y sin registros"
  - "La operación declara x-required-role EDITOR en el contrato"
created: 2026-10-02
updated: 2026-10-03
---

# TC-AUDIT-ACCESS-001 — Solo OWNER y EDITOR pueden leer la auditoría; VIEWER recibe INSUFFICIENT_ROLE

## Intención

Matriz de autorización docs/10 §14: el audit log no es visible para VIEWER.

## Escenario

```gherkin
Dado un usuario VIEWER de "W1"
Cuando consulta el historial de auditoría de "Bank A"
Entonces recibe INSUFFICIENT_ROLE
```

## Notas

- Automatización (add-audit-trail): Por HTTP se consulta el historial del agregado `Workspace` de W1.
