---
id: TC-IDENTITY-AUTH-003
title: Ningún token de acceso, refresh ni id es observable desde el navegador
spec: identity/authentication
related_specs: []
requirement: Tokens fuera del alcance del navegador
scenario: Ningún token es observable desde el navegador
requirement_status: confirmed
fr:
- FR-IDENTITY-001
nfr:
- NFR-SEC-001
invariants: []
priority: critical
type: security
level: e2e
automation_status: automated
automated_tests:
- tests/e2e/specs/auth.spec.ts
- apps/web/test/integration/bff.int.test.ts
- apps/web/src/bff/session-crypto.test.ts
status: automated
regression_suite: true
phase: 1
tags:
- authn
- bff
- xss
error_code: null
preconditions:
- Stack core
- Usuario owner autenticado con el Minimal Seed cargado
input:
  paginas:
  - /
  - /cuentas
  - /transacciones
  - /configuracion
steps:
- Navegar por cada página
- Leer document.cookie, localStorage y sessionStorage
- Interceptar todas las respuestas HTML y JSON del BFF
- Inspeccionar el registro de la sesión en el almacén de sesiones
expected_result:
- Ningún valor con forma de JWT ni refresh token aparece en document.cookie, localStorage, sessionStorage, HTML ni JSON
- En el almacén de sesiones los tokens están cifrados (no se decodifican como JWT en texto plano)
created: 2026-10-02
updated: 2026-10-02
---

# TC-IDENTITY-AUTH-003 — Ningún token de acceso, refresh ni id es observable desde el navegador

## Intención

Un token accesible por JavaScript sería robable vía XSS (ADR-0010, NFR-SEC-001).

## Escenario

```gherkin
Dado un usuario autenticado
Cuando navega por las páginas principales
Entonces ningún token es legible desde el navegador
  Y los tokens se guardan cifrados del lado servidor
```

## Notas

- Detector: regex de JWT (tres segmentos base64url) y prefijos conocidos de refresh token de Keycloak.
