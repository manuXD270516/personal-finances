---
id: TC-SECURITY-RLS-003
title: Peticiones intercaladas de dos workspaces en el mismo pool nunca mezclan datos
spec: security/access-control
related_specs: []
requirement: Contexto de workspace acotado a cada transacción
scenario: Peticiones intercaladas en el mismo pool
requirement_status: confirmed
fr: []
nfr:
- NFR-SEC-004
invariants:
- INV-025
priority: critical
type: security
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- rls
- pool
- concurrency
error_code: null
preconditions:
- finance-api con pool de 2 conexiones contra PostgreSQL (Testcontainers)
- Minimal Seed; owner es miembro de W1 y W2
input:
  peticiones: 200
  workspaces:
  - W1
  - W2
  pool_size: 2
steps:
- Lanzar concurrentemente 200 GET de cuentas alternando W1 y W2
- Verificar cada respuesta
- Reutilizar una conexión que ejecutó una transacción con contexto W1 para una consulta sin contexto
expected_result:
- Ninguna respuesta de W1 contiene cuentas de W2 ni viceversa
- La consulta sin contexto no ve filas de W1
- El lint de CI no encuentra 'SET app.' sin LOCAL en el código
created: 2026-10-02
updated: 2026-10-02
---

# TC-SECURITY-RLS-003 — Peticiones intercaladas de dos workspaces en el mismo pool nunca mezclan datos

## Intención

SET de sesión con pooling filtra contexto entre requests; solo SET LOCAL por transacción es seguro (NFR-SEC-004).

## Escenario

```gherkin
Dadas peticiones intercaladas de "W1" y "W2" sobre un pool de 2 conexiones
Cuando se ejecutan concurrentemente
Entonces ninguna respuesta mezcla workspaces
```
