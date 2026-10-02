---
id: TC-IDENTITY-SESSION-001
title: Peticiones concurrentes con el token por expirar provocan un único refresh
spec: identity/authentication
related_specs: []
requirement: Renovación de sesión con refresh de un solo vuelo
scenario: Peticiones concurrentes con el token por expirar
requirement_status: confirmed
fr:
- FR-IDENTITY-002
nfr:
- NFR-SEC-017
invariants: []
priority: critical
type: integration
level: container-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags:
- session
- refresh
- concurrency
error_code: null
preconditions:
- Keycloak con refreshTokenMaxReuse=0 y PostgreSQL (Testcontainers)
- Sesión activa cuyo access token expira en 30 s
input:
  peticiones_concurrentes: 5
  endpoint: GET /api/bff/v1/me
steps:
- Enviar 5 peticiones simultáneas al BFF con la misma cookie
- Contar las llamadas al token endpoint del IdP
- Enviar una sexta petición tras completar las anteriores
- Revocar el refresh token en el IdP, forzar la expiración y enviar otra petición
expected_result:
- Exactamente 1 llamada de refresh al IdP
- Las 5 peticiones responden 200 y la sexta también (la sesión sigue activa en Keycloak)
- 'Con el refresh revocado: 401 UNAUTHENTICATED y la sesión se elimina del almacén'
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-SESSION-001 — Peticiones concurrentes con el token por expirar provocan un único refresh

## Intención

Reutilizar un refresh token rotado hace que Keycloak invalide toda la sesión (hallazgo de SPIKE-06, enmienda de ADR-0010).

## Escenario

```gherkin
Dada una sesión cuyo access token está por expirar
Cuando llegan cinco peticiones simultáneas
Entonces el BFF renueva el token una sola vez
  Y todas las peticiones se completan
```

## Notas

- Variante con dos instancias del BFF compartiendo PostgreSQL para probar el advisory lock entre procesos.
