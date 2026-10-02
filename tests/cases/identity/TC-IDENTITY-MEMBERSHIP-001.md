---
id: TC-IDENTITY-MEMBERSHIP-001
title: "Un usuario que no es miembro no puede acceder a un workspace"
spec: identity/workspace-membership
related_specs: ["security/access-control"]
requirement: "Membresía en el workspace"
scenario: null
requirement_status: provisional
fr: [FR-IDENTITY-002]
nfr: [NFR-SEC-001]
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["authz", "membership"]
error_code: "WORKSPACE_NOT_FOUND"
preconditions: ["El usuario outsider es OWNER solo de W2 (Minimal Seed)"]
input:
  user: "outsider"
  requests:
    - "GET /api/v1/workspaces/{W1}/accounts"
    - "POST /api/v1/workspaces/{W1}/transactions"
steps:
  - "Enviar cada solicitud como outsider"
  - "GET /api/v1/workspaces como outsider"
expected_result:
  - "Ambas solicitudes: 404 problem+json con código WORKSPACE_NOT_FOUND (no revela su existencia)"
  - "La lista de workspaces contiene solo W2"
  - "Ninguna mutación en W1"
created: 2026-10-01
updated: 2026-10-01
---

# TC-IDENTITY-MEMBERSHIP-001 — Un usuario que no es miembro no puede acceder a un workspace

## Intención

El workspace de la ruta se valida contra la membresía antes de llegar a cualquier caso de uso (ARCHITECTURE §8).

## Escenario

```gherkin
Dado que el usuario "outsider" no es miembro del workspace "W1"
Cuando "outsider" solicita las cuentas de "W1"
Entonces el estado de la respuesta es 404
```

## Notas

- 404 frente a 403 queda por confirmar en la especificación security/access-control.
