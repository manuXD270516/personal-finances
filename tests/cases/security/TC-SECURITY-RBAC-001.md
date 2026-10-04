---
id: TC-SECURITY-RBAC-001
title: VIEWER puede leer pero no puede modificar datos financieros
spec: security/access-control
related_specs: []
requirement: Autorización basada en roles
scenario: VIEWER intenta registrar un gasto
requirement_status: confirmed
fr:
- FR-IDENTITY-006
nfr:
- NFR-SEC-003
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/identity/src/application/identity.service.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- rbac
error_code: INSUFFICIENT_ROLE
preconditions:
- El usuario viewer tiene el rol VIEWER en W1 (Minimal Seed)
input:
  allowed:
  - GET /api/v1/workspaces/{W1}/accounts
  - GET /api/v1/workspaces/{W1}/transactions
  denied:
  - POST /api/v1/workspaces/{W1}/transactions (gasto de 75.00 BOB)
  - POST /api/v1/workspaces/{W1}/transfers
  - PATCH /api/v1/workspaces/{W1}/transactions/{T1}
  - POST /api/v1/workspaces/{W1}/categories
steps:
- Enviar cada solicitud como viewer (con Idempotency-Key e If-Match donde se requiera)
expected_result:
- 'GETs: 200'
- 'Mutaciones: 403 problem+json con código INSUFFICIENT_ROLE'
- Las solicitudes denegadas no crean ninguna transacción, asiento, fila de auditoría ni evento de outbox
created: 2026-10-01
updated: 2026-10-04
---

# TC-SECURITY-RBAC-001 — VIEWER puede leer pero no puede modificar datos financieros

## Intención

La autorización se aplica en la capa de aplicación por caso de uso, no solo en la UI.

## Escenario

```gherkin
Dado que el usuario "viewer" tiene el rol VIEWER en el workspace "W1"
Cuando "viewer" intenta registrar un gasto de 75.00 BOB en "W1"
Entonces el estado de la respuesta es 403
  Y el código del problema es "INSUFFICIENT_ROLE"
  Y no se persiste nada
```

## Notas

- Código actualizado de FORBIDDEN a INSUFFICIENT_ROLE (docs/10 §9.1).
- Verificado 2026-10-04: a nivel API, la matriz [TC-SECURITY-RBAC-002] (apps/api/test/api/authorization-matrix.api.test.ts) comprueba 200 en lecturas y 403 INSUFFICIENT_ROLE en mutaciones de VIEWER para toda operación implementada.
