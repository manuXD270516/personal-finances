---
id: TC-IDENTITY-AUTH-002
title: El login OIDC vía BFF usa PKCE y crea una cookie de sesión segura y opaca
spec: identity/authentication
related_specs: []
requirement: Inicio de sesión OIDC mediante el BFF
scenario: Login exitoso crea una cookie de sesión segura
requirement_status: confirmed
fr:
- FR-IDENTITY-001
nfr:
- NFR-SEC-001
invariants: []
priority: critical
type: e2e
level: e2e
automation_status: automated
automated_tests:
- tests/e2e/specs/auth.spec.ts
- apps/web/test/integration/bff.int.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- authn
- oidc
- bff
- pkce
error_code: null
preconditions:
- Stack core con Keycloak (realm de desarrollo) y finance-web
- Usuario owner@demo.pfos.test en el realm
input:
  pagina_inicial: /
  usuario: owner@demo.pfos.test
steps:
- Abrir / sin sesión y capturar la redirección
- Completar el login en Keycloak
- Inspeccionar la cookie Set-Cookie del callback
- Repetir el callback con el mismo state
- Llamar al callback con un state nunca emitido
expected_result:
- La redirección al IdP incluye response_type=code, code_challenge_method=S256, state y nonce
- La cookie de sesión es __Host-, HttpOnly, Secure, SameSite=Lax, Path=/ y sin Domain; su valor no es un JWT ni contiene tokens
- El callback con state reutilizado o desconocido no crea sesión y muestra una página de error en español
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-AUTH-002 — El login OIDC vía BFF usa PKCE y crea una cookie de sesión segura y opaca

## Intención

El login es la puerta de entrada de datos financieros sensibles; PKCE y state de un solo uso evitan la inyección de códigos y CSRF de login (ADR-0010, docs/12 §3).

## Escenario

```gherkin
Dado un usuario sin sesión
Cuando abre la aplicación y completa el login en el proveedor de identidad
Entonces el BFF crea una cookie de sesión HttpOnly, Secure y SameSite=Lax
  Y la cookie no contiene ningún token
```

## Notas

- Basado en la evidencia de SPIKE-06 (spikes/SPIKE-06-auth-bff).
