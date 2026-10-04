---
id: TC-PLATFORM-API-001
title: Las operaciones viven bajo /api/v1 y una versión no publicada responde 404
spec: platform/api-conventions
related_specs: []
requirement: Versionado de la API en la ruta
scenario: null
requirement_status: confirmed
fr: []
nfr:
- NFR-MAINT-009
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/api-conventions.api.test.ts
  - apps/api/test/api/contract-routes.api.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- versioning
error_code: RESOURCE_NOT_FOUND
preconditions:
- finance-api bajo prueba con usuario owner autenticado
input:
- request: GET /api/v1/me
- request: GET /api/v2/me
- request: GET /api/v1/no-existe
steps:
- Enviar cada solicitud
expected_result:
- '/api/v1/me: 200'
- '/api/v2/me y /api/v1/no-existe: 404 application/problem+json con código RESOURCE_NOT_FOUND'
created: 2026-10-02
updated: 2026-10-04
---

# TC-PLATFORM-API-001 — Las operaciones viven bajo /api/v1 y una versión no publicada responde 404

## Intención

La versión mayor en la ruta permite evolucionar sin romper clientes (ADR-0022).

## Escenario

```gherkin
Dado un cliente autenticado
Cuando llama a "GET /api/v2/me"
Entonces la respuesta es 404 con código "RESOURCE_NOT_FOUND"
```
