---
id: TC-PLATFORM-API-012
title: Los GET de agregados devuelven ETag y If-None-Match vigente responde 304
spec: platform/api-conventions
related_specs: []
requirement: ETag en recursos versionados
scenario: Lectura con versión vigente
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-011
nfr:
- NFR-DATA-014
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- etag
- caching
error_code: null
preconditions:
- W1 Personal Demo en versión 3; owner autenticado
input:
- request: GET /api/v1/workspaces/{W1}
- request: GET /api/v1/workspaces/{W1}
  If-None-Match: '"3"'
- request: GET /api/v1/workspaces/{W1}
  If-None-Match: '"2"'
steps:
- Enviar cada solicitud
expected_result:
- 'Primera: 200 con ETag "3"'
- 'If-None-Match "3": 304 sin cuerpo'
- 'If-None-Match "2": 200 con el cuerpo y ETag "3"'
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-012 — Los GET de agregados devuelven ETag y If-None-Match vigente responde 304

## Intención

ETag permite caché segura en el BFF y es la base del control de concurrencia (docs/10 §6).

## Escenario

```gherkin
Dado un workspace en versión 3
Cuando se lee con "If-None-Match" igual a "3"
Entonces la respuesta es 304 sin cuerpo
```
