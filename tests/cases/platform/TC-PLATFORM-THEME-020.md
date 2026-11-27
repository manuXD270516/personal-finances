---
id: TC-PLATFORM-THEME-020
title: "Con «Sistema» el documento declara los dos esquemas y un color de barra por esquema"
spec: platform/web-interface
related_specs: []
requirement: "Barra del navegador acorde al tema"
scenario: "Tema del sistema"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "viewport"]
error_code: null
preconditions:
  - "sin cookie pfos_theme"
input: {}
steps:
  - "el OWNER abre Transacciones y se lee el HTML crudo"
expected_result:
  - "<meta name=\"color-scheme\" content=\"light dark\">"
  - "dos <meta name=\"theme-color\"> con media (prefers-color-scheme: light) y (prefers-color-scheme: dark)"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-020 — Con «Sistema» el documento declara los dos esquemas y un color de barra por esquema

## Intención

Verifica el requirement «Barra del navegador acorde al tema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado sin cookie pfos_theme
Cuando el OWNER abre Transacciones y se lee el HTML crudo
Entonces <meta name="color-scheme" content="light dark">
  Y dos <meta name="theme-color"> con media (prefers-color-scheme: light) y (prefers-color-scheme: dark)
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
