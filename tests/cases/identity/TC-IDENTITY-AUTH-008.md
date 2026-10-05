---
id: TC-IDENTITY-AUTH-008
title: El usuario actualiza locale y zona horaria y una zona inválida se rechaza
spec: identity/authentication
related_specs: []
requirement: Preferencias personales del usuario
scenario: null
requirement_status: confirmed
fr:
- FR-IDENTITY-003
nfr:
- NFR-USAB-004
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
- apps/api/test/api/identity.api.test.ts
- tests/e2e/specs/workspace-identity.spec.ts
status: automated
regression_suite: false
phase: 1
tags:
- profile
- preferences
- timezone
error_code: INVALID_TIMEZONE
preconditions:
- Usuario owner con perfil en versión 3
input:
- If-Match: '"3"'
  body:
    locale: en-US
    timezone: America/Sao_Paulo
- If-Match: '"4"'
  body:
    timezone: Bolivia/LaPaz
steps:
- PATCH /api/v1/me con el primer cuerpo
- PATCH /api/v1/me con el segundo cuerpo
- GET /api/v1/me
expected_result:
- 'Primer PATCH: 200 con locale en-US, timezone America/Sao_Paulo y ETag "4"'
- 'Segundo PATCH: 422 problem+json con código INVALID_TIMEZONE'
- El perfil final conserva America/Sao_Paulo
created: 2026-10-02
updated: 2026-10-04
---

# TC-IDENTITY-AUTH-008 — El usuario actualiza locale y zona horaria y una zona inválida se rechaza

## Intención

La zona horaria personal afecta cómo se muestran instantes; un valor inválido rompería las vistas.

## Escenario

```gherkin
Dado el perfil del usuario en versión 3
Cuando cambia su zona horaria a "America/Sao_Paulo"
Entonces el perfil devuelve la zona nueva con versión 4
Cuando envía la zona "Bolivia/LaPaz"
Entonces la respuesta es 422 con código "INVALID_TIMEZONE"
```

## Notas

- Requirement Should.
