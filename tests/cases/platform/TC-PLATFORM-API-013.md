---
id: TC-PLATFORM-API-013
title: Una modificación sin If-Match se rechaza con 428 sin cambios
spec: platform/api-conventions
related_specs: []
requirement: If-Match obligatorio en modificaciones
scenario: Modificación sin If-Match
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-011
nfr:
- NFR-DATA-014
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/api-conventions.api.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- etag
- concurrency
error_code: PRECONDITION_REQUIRED
preconditions:
- W1 Personal Demo; owner autenticado
input:
  request: PATCH /api/v1/workspaces/{W1}
  If-Match: null
  body:
    name: Otro nombre
steps:
- Enviar el PATCH sin If-Match
- GET /api/v1/workspaces/{W1}
expected_result:
- 428 PRECONDITION_REQUIRED
- El nombre y la versión no cambian
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-013 — Una modificación sin If-Match se rechaza con 428 sin cambios

## Intención

Sin If-Match no se puede detectar una actualización perdida (NFR-DATA-014).

## Escenario

```gherkin
Cuando un OWNER cambia el nombre de su workspace sin "If-Match"
Entonces la respuesta es 428 con código "PRECONDITION_REQUIRED"
  Y el nombre no cambia
```
