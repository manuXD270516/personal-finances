---
id: TC-PLATFORM-THEME-012
title: "El callback de login deja la marca del tema guardado"
spec: platform/web-interface
related_specs: ["identity/authentication"]
requirement: "Tema recordado al iniciar sesión"
scenario: "Inicio de sesión con el tema oscuro guardado"
requirement_status: confirmed
fr: ["FR-IDENTITY-001"]
nfr: ["NFR-USAB-103", "NFR-SEC-001"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
  - apps/web/src/ui/common/theme.test.ts
  - apps/web/test/integration/bff.int.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "bff", "auth"]
error_code: null
preconditions:
  - "perfil del OWNER con tema «Oscuro»"
input: {}
steps:
  - "el OWNER inicia sesión en un contexto de navegador nuevo"
expected_result:
  - "la respuesta del callback incluye Set-Cookie pfos_theme=dark con Path=/ y SameSite=Lax"
  - "el valor de la cookie es exactamente \"dark\", sin identificadores ni tokens"
  - "la primera página tras el login tiene data-theme=\"dark\" en el HTML crudo"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-012 — El callback de login deja la marca del tema guardado

## Intención

Verifica el requirement «Tema recordado al iniciar sesión» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado perfil del OWNER con tema «Oscuro»
Cuando el OWNER inicia sesión en un contexto de navegador nuevo
Entonces la respuesta del callback incluye Set-Cookie pfos_theme=dark con Path=/ y SameSite=Lax
  Y el valor de la cookie es exactamente "dark", sin identificadores ni tokens
  Y la primera página tras el login tiene data-theme="dark" en el HTML crudo
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
