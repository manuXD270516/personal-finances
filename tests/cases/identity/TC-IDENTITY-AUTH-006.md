---
id: TC-IDENTITY-AUTH-006
title: GET /me devuelve el perfil del usuario con locale, zona horaria y membresías activas
spec: identity/authentication
related_specs:
- identity/workspace-membership
requirement: Perfil del usuario autenticado
scenario: Consulta del perfil
requirement_status: confirmed
fr:
- FR-IDENTITY-003
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/workspace-base-currency.api.test.ts
- apps/api/test/api/identity.api.test.ts
status: automated
regression_suite: false
phase: 1
tags:
- profile
- me
error_code: null
preconditions:
- 'Minimal Seed: owner@demo.pfos.test es OWNER de W1 Personal Demo y de W2 Other Demo, locale es-BO, zona America/La_Paz'
- Una membresía revocada del owner en un tercer workspace W3
input:
  endpoint: GET /api/v1/me
  usuario: owner
steps:
- Llamar GET /api/v1/me como owner
- Validar la respuesta contra el schema Me del contrato
expected_result:
- 200 con id, displayName, email owner@demo.pfos.test, locale es-BO, timezone America/La_Paz y ETag
- memberships contiene exactamente W1 Personal Demo (OWNER) y W2 Other Demo (OWNER); W3 no aparece
- La respuesta cumple el schema Me
created: 2026-10-02
updated: 2026-10-04
---

# TC-IDENTITY-AUTH-006 — GET /me devuelve el perfil del usuario con locale, zona horaria y membresías activas

## Intención

El BFF usa /me para decidir qué workspaces ofrecer; un rol o workspace incorrecto expone o esconde datos (FR-IDENTITY-003).

## Escenario

```gherkin
Dado que "owner" es OWNER de "W1 Personal Demo" y de "W2 Other Demo"
Cuando consulta su perfil
Entonces ve su locale "es-BO" y su zona horaria "America/La_Paz"
  Y ve exactamente sus dos membresías activas con rol OWNER
```
