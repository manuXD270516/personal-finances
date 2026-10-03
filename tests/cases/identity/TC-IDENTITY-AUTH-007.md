---
id: TC-IDENTITY-AUTH-007
title: El primer acceso provisiona exactamente un usuario y rechaza emails no verificados
spec: identity/authentication
related_specs: []
requirement: Provisión del usuario en el primer acceso
scenario: Accesos concurrentes no duplican el usuario
requirement_status: confirmed
fr:
- FR-IDENTITY-001
- FR-IDENTITY-003
nfr:
- NFR-SEC-002
invariants: []
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
- packages/contexts/identity/test/integration/pg-identity.int.test.ts
- packages/contexts/identity/src/application/identity.service.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- provisioning
- jit
- idempotency
error_code: UNAUTHENTICATED
preconditions:
- finance-api con PostgreSQL (Testcontainers) y emisor JWKS de prueba
- Ningún usuario con iss=https://idp.test/realms/pfos y sub=kc-0001
input:
- sub: kc-0001
  email: nuevo@demo.pfos.test
  email_verified: true
  concurrencia: 2
- sub: kc-0001
  email: nuevo2@demo.pfos.test
  email_verified: true
  concurrencia: 1
- sub: kc-0002
  email: sinverificar@demo.pfos.test
  email_verified: false
  concurrencia: 1
steps:
- Enviar simultáneamente dos GET /api/v1/me con el token de kc-0001
- Enviar un tercer GET /me con el email cambiado
- Enviar GET /me con el token de kc-0002
expected_result:
- Existe exactamente un usuario para (iss, kc-0001); ambas respuestas 200 con el mismo id
- Tras el tercer acceso el email del usuario es nuevo2@demo.pfos.test y el id no cambia
- 'kc-0002: 401 UNAUTHENTICATED y no se crea ningún usuario'
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-AUTH-007 — El primer acceso provisiona exactamente un usuario y rechaza emails no verificados

## Intención

La identidad local se deriva del IdP sin duplicados ni cuentas no verificadas (docs/12 §3.1; gap de SPIKE-06).

## Escenario

```gherkin
Dada una identidad nueva con email verificado
Cuando llegan dos primeras peticiones simultáneas
Entonces existe exactamente un usuario para esa identidad
```

## Notas

- Relacionado: TC-IDENTITY-WORKSPACE-002 (workspace personal idempotente).
