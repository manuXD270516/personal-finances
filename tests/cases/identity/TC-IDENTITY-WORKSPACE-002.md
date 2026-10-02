---
id: TC-IDENTITY-WORKSPACE-002
title: Dos primeros logins concurrentes crean un único workspace personal
spec: identity/workspace-membership
related_specs: []
requirement: Provisión idempotente del workspace personal
scenario: Dos primeros logins concurrentes
requirement_status: confirmed
fr:
- FR-IDENTITY-004
nfr:
- NFR-REL-007
invariants: []
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
- packages/contexts/identity/test/integration/pg-identity.int.test.ts
- packages/contexts/identity/src/application/identity.service.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- workspace
- idempotency
- concurrency
error_code: null
preconditions:
- PostgreSQL (Testcontainers)
- Usuario nuevo sin membresías
input:
  logins_concurrentes: 2
  logins_posteriores: 1
steps:
- Ejecutar ProvisionUserFromIdentity dos veces en paralelo para el mismo usuario
- Ejecutarlo una tercera vez
- Contar workspaces y eventos
expected_result:
- Exactamente 1 workspace con personal_of_user_id del usuario y 1 membresía OWNER
- Exactamente 1 evento identity.WorkspaceCreated.v1
- El tercer login no crea nada
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-WORKSPACE-002 — Dos primeros logins concurrentes crean un único workspace personal

## Intención

Evita workspaces duplicados que fragmentarían las finanzas del usuario (US-003 AC2).

## Escenario

```gherkin
Dado un usuario nuevo
Cuando completa dos logins simultáneos
Entonces existe exactamente un workspace personal
  Y se publica exactamente un evento de workspace creado
```
