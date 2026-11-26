---
id: TC-PLATFORM-THEME-013
title: "El callback de login quita la marca si el perfil sigue al sistema"
spec: platform/web-interface
related_specs: ["identity/authentication"]
requirement: "Tema recordado al iniciar sesión"
scenario: "Inicio de sesión con «Sistema» tras otro usuario"
requirement_status: confirmed
fr: ["FR-IDENTITY-001"]
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["theme", "bff", "auth"]
error_code: null
preconditions:
  - "cookie pfos_theme=light en el navegador"
input: {}
steps:
  - "un EDITOR con tema «Sistema» inicia sesión en ese navegador"
expected_result:
  - "la respuesta del callback borra pfos_theme"
  - "la página sigue al sistema"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-013 — El callback de login quita la marca si el perfil sigue al sistema

## Intención

Verifica el requirement «Tema recordado al iniciar sesión» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado cookie pfos_theme=light en el navegador
Cuando un EDITOR con tema «Sistema» inicia sesión en ese navegador
Entonces la respuesta del callback borra pfos_theme
  Y la página sigue al sistema
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
