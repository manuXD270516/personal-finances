---
id: TC-IDENTITY-MEMBERSHIP-001
title: Un usuario que no es miembro no puede acceder a un workspace
spec: security/access-control
related_specs:
- identity/workspace-membership
requirement: Rechazo a usuarios que no son miembros del workspace
scenario: Usuario ajeno intenta leer y escribir en otro workspace
requirement_status: confirmed
fr:
- FR-IDENTITY-006
nfr:
- NFR-SEC-003
invariants:
- INV-025
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- authz
- membership
error_code: WORKSPACE_ACCESS_DENIED
preconditions:
- El usuario outsider es OWNER solo de W2 (Minimal Seed)
input:
  user: outsider
  requests:
  - GET /api/v1/workspaces/{W1}/accounts
  - POST /api/v1/workspaces/{W1}/transactions (gasto de 75.00 BOB, con Idempotency-Key)
  - GET /api/v1/workspaces/{W1}
steps:
- Enviar cada solicitud como outsider
- Contar filas de transacciones, asientos, auditoría y outbox de W1 antes y después
- GET /api/v1/workspaces como outsider
expected_result:
- 'Las tres solicitudes: 403 problem+json con código WORKSPACE_ACCESS_DENIED, sin datos de W1'
- Ninguna mutación en W1 (conteos idénticos)
- La lista de workspaces de outsider contiene solo W2
created: 2026-10-01
updated: 2026-10-02
---

# TC-IDENTITY-MEMBERSHIP-001 — Un usuario que no es miembro no puede acceder a un workspace

## Intención

La membresía del workspace de la ruta se verifica antes de cualquier caso de uso (ARCHITECTURE §8, docs/10 §3).

## Escenario

```gherkin
Dado que el usuario "outsider" no es miembro del workspace "W1"
Cuando "outsider" solicita las cuentas de "W1"
Entonces el estado de la respuesta es 403
  Y el código del problema es "WORKSPACE_ACCESS_DENIED"
```

## Notas

- Decisión: 403 WORKSPACE_ACCESS_DENIED (ADR-0010, docs/10 §3); reemplaza el 404 WORKSPACE_NOT_FOUND provisional.
- El POST de transacciones requiere add-transaction-recording; antes de él se usa PATCH /workspaces/{W1}.
