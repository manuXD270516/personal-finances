---
id: TC-SECURITY-RBAC-002
title: La matriz de autorización cubre todas las operaciones de la API para cada rol
spec: security/access-control
related_specs:
- platform/api-conventions
requirement: Matriz de autorización declarada para toda operación
scenario: Ejecución de la matriz completa
requirement_status: confirmed
fr:
- FR-IDENTITY-006
nfr:
- NFR-SEC-002
- NFR-SEC-003
invariants: []
priority: high
type: security
level: security
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- rbac
- matrix
- openapi
error_code: null
preconditions:
- Archivo de matriz declarativa (rol x operationId -> allow/deny) derivado de x-required-role
- Contrato OpenAPI contracts/openapi/finance-api.v1.yaml
- Minimal Seed con owner, editor, viewer y outsider
input:
  roles:
  - OWNER
  - EDITOR
  - VIEWER
  - non-member
  - anonymous
  operations: todos los operationIds de OpenAPI
steps:
- Verificar que cada operationId de OpenAPI declara x-required-role y aparece en la matriz
- Verificar que el rol declarado coincide con el decorador del controller
- Ejecutar cada par (rol, operación) como una prueba de API parametrizada
expected_result:
- Una operación sin x-required-role o ausente en la matriz hace fallar la prueba
- Los pares permitidos devuelven 2xx; los denegados devuelven 401 (anónimo), 403 WORKSPACE_ACCESS_DENIED (no miembro) o 403 INSUFFICIENT_ROLE (rol insuficiente)
- updateWorkspace solo es permitida al OWNER
created: 2026-10-01
updated: 2026-10-02
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

## Notas

- Cada change de Phase 1 que agregue operaciones extiende esta matriz.
