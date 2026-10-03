---
id: TC-IDENTITY-WORKSPACE-001
title: El primer login crea un workspace personal con OWNER, BOB y America/La_Paz
spec: identity/workspace-membership
related_specs: []
requirement: Workspace personal creado en el primer login
scenario: Primer login de un usuario nuevo
requirement_status: confirmed
fr:
- FR-IDENTITY-004
nfr: []
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
- packages/contexts/identity/src/application/identity.service.test.ts
- tests/e2e/specs/authorization.spec.ts
status: automated
regression_suite: true
phase: 1
tags:
- workspace
- onboarding
error_code: null
preconditions:
- Usuario nuevo@demo.pfos.test sin membresías
- viewer@demo.pfos.test es VIEWER de W1 (Minimal Seed) y aún no inició sesión
input:
- usuario: nuevo
- usuario: viewer
steps:
- Primer GET /api/v1/me de cada usuario
- GET /api/v1/workspaces de cada usuario
- Leer platform.outbox
expected_result:
- 'nuevo: existe un workspace con baseCurrency BOB, timezone America/La_Paz, locale es-BO, fiscalMonthStartDay 1, minimumLiquidityReserve null; nuevo es su único miembro con rol OWNER'
- Se escribe un evento identity.WorkspaceCreated.v1 con origin PERSONAL_DEFAULT
- 'viewer: no se crea workspace personal; su lista contiene solo W1 Personal Demo'
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-WORKSPACE-001 — El primer login crea un workspace personal con OWNER, BOB y America/La_Paz

## Intención

Onboarding sin fricción para el owner (US-003) sin crear workspaces innecesarios a miembros existentes.

## Escenario

```gherkin
Dado un usuario sin membresías
Cuando inicia sesión por primera vez
Entonces existe un workspace con moneda base "BOB" y zona "America/La_Paz"
  Y el usuario es su OWNER
```

## Notas

- Valida el evento contra contracts/events/identity/WorkspaceCreated.v1.schema.json.
