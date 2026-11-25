---
id: TC-SECURITY-CSP-004
title: "Un sitio ajeno no puede enmarcar la web"
spec: security/access-control
related_specs: []
requirement: "La web no se puede enmarcar desde ningún origen"
scenario: "Página enmarcada por un sitio ajeno"
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
  - apps/web/src/security/csp.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["csp","security-headers","add-web-content-security-policy"]
error_code: null
preconditions:
  - "Stack E2E y una página de prueba servida por Playwright en otro origen"
input: {"frame_src":"/es"}
steps:
  - "Abrir la página de prueba que incrusta el Home de la web en un iframe"
expected_result:
  - "El iframe no muestra la web y el navegador informa el bloqueo por frame-ancestors"
  - "La cabecera de la web contiene frame-ancestors none"
created: 2026-11-24
updated: 2026-11-24
---

# TC-SECURITY-CSP-004 — Un sitio ajeno no puede enmarcar la web

## Intención

Requirement «La web no se puede enmarcar desde ningún origen» de `security/access-control` (change `add-web-content-security-policy`, C13 del despliegue N1).

## Escenario

```gherkin
Dado un sitio ajeno con un iframe que apunta al Home
Cuando el navegador lo carga
Entonces la web no se muestra porque frame-ancestors es none
```

## Notas

- Sin X-Frame-Options: los navegadores soportados aplican frame-ancestors.
