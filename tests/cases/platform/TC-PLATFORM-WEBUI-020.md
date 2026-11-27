---
id: TC-PLATFORM-WEBUI-020
title: "La sesión persiste en WebKit con la cookie de producción sin atributos relajados"
spec: platform/web-interface
related_specs: ["identity/authentication"]
requirement: "Cobertura de la interfaz en WebKit"
scenario: "Inicio de sesión en WebKit con la cookie de producción"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-005","NFR-SEC-001"]
invariants: []
priority: high
type: security
level: security
automation_status: automated
automated_tests:
  - tests/e2e/specs/auth.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["e2e","webkit","session"]
error_code: null
preconditions:
  - "el stack de E2E servido por HTTPS (D516), levantado con PF_E2E_PROJECT=pfos-e2e-<nombre> y puertos con prefijo 3 o 4"
  - "el proyecto webkit de Playwright"
input: {}
steps:
  - "el usuario de prueba inicia sesión en WebKit"
  - "navega a dos páginas de la aplicación"
expected_result:
  - "la sesión persiste entre páginas"
  - "la cookie __Host-pfos_sid es Secure, HttpOnly y con Path=/"
  - "ningún atributo difiere del de producción"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-WEBUI-020 — La sesión persiste en WebKit con la cookie de producción sin atributos relajados

## Intención

Es el spike de D509 convertido en prueba: confirma que WebKit no obliga a relajar la cookie de sesión.

## Escenario

```gherkin
Dado el stack de E2E servido por HTTPS (D516), levantado con PF_E2E_PROJECT=pfos-e2e-<nombre> y puertos con prefijo 3 o 4
  Y el proyecto webkit de Playwright
Cuando el usuario de prueba inicia sesión en WebKit
  Y navega a dos páginas de la aplicación
Entonces la sesión persiste entre páginas
  Y la cookie __Host-pfos_sid es Secure, HttpOnly y con Path=/
  Y ningún atributo difiere del de producción
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner. Si el spike falla, no se cambia ningún atributo: la pregunta vuelve al owner (excepción de P10).
- El spike de D509 falló (la cookie `Secure` no viaja sobre `http://localhost` en WebKit, ni en Windows ni en Linux). El owner eligió servir el E2E por HTTPS (D516, [docs/84](../../../docs/84-webkit-e2e-questions.md)); lo automatiza el change `add-e2e-https`.
