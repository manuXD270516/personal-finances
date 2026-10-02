---
id: TC-SECURITY-RBAC-001
title: "VIEWER puede leer pero no puede modificar datos financieros"
spec: security/access-control
related_specs: []
requirement: "Autorización basada en roles"
scenario: null
requirement_status: provisional
fr: [FR-IDENTITY-002]
nfr: [NFR-SEC-002]
invariants: []
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["rbac"]
error_code: "FORBIDDEN"
preconditions: ["El usuario viewer tiene el rol VIEWER en W1 (Minimal Seed)"]
input:
  allowed:
    - "GET /api/v1/workspaces/{W1}/accounts"
    - "GET /api/v1/workspaces/{W1}/transactions"
  denied:
    - "POST /api/v1/workspaces/{W1}/transactions"
    - "POST /api/v1/workspaces/{W1}/transfers"
    - "PATCH /api/v1/workspaces/{W1}/transactions/{T1}"
    - "POST /api/v1/workspaces/{W1}/categories"
steps: ["Enviar cada solicitud como viewer (con Idempotency-Key donde se requiera)"]
expected_result:
  - "GETs: 200"
  - "Mutaciones: 403 problem+json con código FORBIDDEN"
  - "Las solicitudes denegadas no crean ninguna transacción, asiento, fila de auditoría ni evento de outbox"
created: 2026-10-01
updated: 2026-10-01
---

# TC-SECURITY-RBAC-001 — VIEWER puede leer pero no puede modificar datos financieros

## Intención

La autorización se aplica en la capa de aplicación por caso de uso, no solo en la UI.

## Escenario

```gherkin
Dado que el usuario "viewer" tiene el rol VIEWER en el workspace "W1"
Cuando "viewer" intenta registrar una transacción en "W1"
Entonces el estado de la respuesta es 403
  Y no se persiste nada
```
