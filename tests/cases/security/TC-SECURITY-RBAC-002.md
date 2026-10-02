---
id: TC-SECURITY-RBAC-002
title: "La matriz de autorización cubre todas las operaciones de la API para cada rol"
spec: security/access-control
related_specs: ["platform/api-conventions"]
requirement: "Autorización basada en roles"
scenario: null
requirement_status: provisional
fr: [FR-IDENTITY-002]
nfr: [NFR-SEC-002]
invariants: []
priority: high
type: security
level: security
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["rbac", "matrix", "openapi"]
error_code: null
preconditions:
  - "Archivo de matriz declarativa (rol x operationId -> allow/deny)"
  - "Contrato OpenAPI contracts/openapi/finance-api.v1.yaml"
input:
  roles: ["OWNER", "EDITOR", "VIEWER", "non-member", "anonymous"]
  operations: "todos los operationIds de OpenAPI"
steps:
  - "Verificar que cada operationId de OpenAPI aparece en la matriz"
  - "Ejecutar cada par (rol, operación) como una prueba de API parametrizada"
expected_result:
  - "Una operación ausente en la matriz hace fallar la prueba"
  - "Los pares permitidos devuelven 2xx; los denegados devuelven 401/403/404 según lo especificado"
  - "Las operaciones de gestión de membresías son exclusivas de OWNER"
created: 2026-10-01
updated: 2026-10-01
---

# TC-SECURITY-RBAC-002 — La matriz de autorización cubre todas las operaciones de la API para cada rol

## Intención

No es posible publicar un endpoint nuevo sin una decisión de autorización explícita.

## Escenario

```gherkin
Dados la matriz de autorización y el contrato OpenAPI
Cuando cada rol llama a cada operación
Entonces cada respuesta coincide con la matriz
```
