---
id: TC-SECURITY-RBAC-003
title: EDITOR no puede modificar la configuración del workspace
spec: security/access-control
related_specs:
- identity/workspace-membership
requirement: Autorización basada en roles
scenario: EDITOR intenta cambiar la configuración del workspace
requirement_status: confirmed
fr:
- FR-IDENTITY-006
- FR-IDENTITY-005
nfr:
- NFR-SEC-003
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/identity.api.test.ts
- tests/e2e/specs/authorization.spec.ts
status: automated
regression_suite: true
phase: 1
tags:
- rbac
- workspace
error_code: INSUFFICIENT_ROLE
preconditions:
- editor@demo.pfos.test es EDITOR de W1 (Minimal Seed); W1 con base BOB
input:
  endpoint: PATCH /api/v1/workspaces/{W1}
  If-Match: versión vigente
  body:
    baseCurrency: USD
steps:
- Enviar el PATCH como editor
- GET /api/v1/workspaces/{W1}
- Leer platform.outbox
expected_result:
- 403 problem+json con código INSUFFICIENT_ROLE
- La moneda base sigue en BOB y la versión no cambia
- No se escribe identity.WorkspaceSettingsChanged.v1
created: 2026-10-02
updated: 2026-10-02
---

# TC-SECURITY-RBAC-003 — EDITOR no puede modificar la configuración del workspace

## Intención

La configuración del workspace es exclusiva del OWNER (docs/10 §14, US-004 AC2).

## Escenario

```gherkin
Dado que "editor" es EDITOR de "W1"
Cuando intenta cambiar la moneda base a "USD"
Entonces la respuesta es 403 con código "INSUFFICIENT_ROLE"
  Y la moneda base sigue siendo "BOB"
```
