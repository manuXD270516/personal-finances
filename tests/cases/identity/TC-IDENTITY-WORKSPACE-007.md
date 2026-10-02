---
id: TC-IDENTITY-WORKSPACE-007
title: Un usuario crea un workspace adicional y queda como su OWNER
spec: identity/workspace-membership
related_specs:
- platform/api-conventions
requirement: Creación de workspaces adicionales
scenario: Crear un workspace del hogar
requirement_status: confirmed
fr:
- FR-IDENTITY-007
nfr:
- NFR-REL-007
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- workspace
- idempotency
error_code: null
preconditions:
- owner autenticado
input:
  endpoint: POST /api/v1/workspaces
  idempotency_key: 0192f3c5-6a1b-7c2d-8e3f-000000000101
  body:
    name: Hogar
    baseCurrency: BOB
steps:
- Enviar el POST
- Repetir el POST con la misma clave
- GET /api/v1/workspaces
expected_result:
- 201 con name Hogar, timezone America/La_Paz, locale es-BO, role OWNER, Location y ETag
- 'La repetición devuelve el mismo workspace con Idempotent-Replayed: true'
- Hogar aparece una sola vez en la lista
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-WORKSPACE-007 — Un usuario crea un workspace adicional y queda como su OWNER

## Intención

Permite separar finanzas (hogar, negocio) sin duplicados por reintentos.

## Escenario

```gherkin
Dado un usuario autenticado
Cuando crea el workspace "Hogar" con moneda base "BOB"
Entonces queda como OWNER de "Hogar"
  Y "Hogar" aparece en su lista de workspaces
```

## Notas

- Requirement Should.
