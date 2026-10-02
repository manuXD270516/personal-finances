---
id: TC-PLATFORM-API-006
title: Las peticiones con campos desconocidos o tipos incorrectos se rechazan con 400
spec: platform/api-conventions
related_specs: []
requirement: Validación de peticiones contra el contrato
scenario: Campo desconocido en el cuerpo
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-009
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- validation
- contract
error_code: VALIDATION_FAILED
preconditions:
- owner autenticado
input:
- body:
    name: Hogar
    baseCurrency: BOB
    ownerId: 0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d8e
- body:
    baseCurrency: BOB
- body:
    name: 123
    baseCurrency: BOB
steps:
- POST /api/v1/workspaces con cada cuerpo y una clave de idempotencia nueva
expected_result:
- 'Los tres: 400 VALIDATION_FAILED con errors[] señalando /ownerId, /name (ausente) y /name (tipo)'
- No se crea ningún workspace
created: 2026-10-02
updated: 2026-10-02
---

# TC-PLATFORM-API-006 — Las peticiones con campos desconocidos o tipos incorrectos se rechazan con 400

## Intención

Rechazar en el borde evita que datos inesperados lleguen al dominio (NFR-SEC-009).

## Escenario

```gherkin
Cuando un cliente crea un workspace enviando el campo adicional "ownerId"
Entonces la respuesta es 400 con código "VALIDATION_FAILED"
  Y no se crea ningún workspace
```
