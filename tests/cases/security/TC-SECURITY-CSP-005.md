---
id: TC-SECURITY-CSP-005
title: "Las páginas públicas de auth también salen con CSP y nonce"
spec: security/access-control
related_specs: ["identity/authentication"]
requirement: "Política de seguridad de contenido con nonce por petición en las páginas de la web"
scenario: "Página pública también protegida"
requirement_status: confirmed
fr: []
nfr: ["NFR-SEC-008"]
invariants: []
priority: high
type: security
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/content-security-policy.spec.ts
  - apps/web/src/security/proxy.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Stack E2E sin sesión en el navegador"
input: {"path":"/es/auth/error"}
steps:
  - "Abrir la página de error de login sin sesión"
  - "Comparar el nonce de la cabecera con el de los scripts"
expected_result:
  - "La respuesta trae la CSP aplicada con nonce y los scripts lo llevan"
  - "La página se muestra sin violaciones (renderizado por petición, no prerenderizada en el build)"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-005 — Las páginas públicas de auth también salen con CSP y nonce

## Intención

Requirement «Política de seguridad de contenido con nonce por petición en las páginas de la web» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado un visitante sin sesión
Cuando abre la página de error de login
Entonces la respuesta trae la CSP con nonce propio y sus scripts lo llevan
```

## Notas

- Hoy esta página se prerenderiza en el build y no tendría nonce; con connection() en el layout pasa a renderizarse por petición.
