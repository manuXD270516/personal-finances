---
id: TC-PLATFORM-THEME-019
title: "Con «Oscuro» el documento declara el esquema y el color de barra oscuros"
spec: platform/web-interface
related_specs: []
requirement: "Barra del navegador acorde al tema"
scenario: "Tema oscuro elegido"
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
  - apps/web/src/ui/common/theme.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "viewport"]
error_code: null
preconditions:
  - "cookie pfos_theme=dark"
input: {}
steps:
  - "el OWNER abre Transacciones y se lee el HTML crudo"
expected_result:
  - "<meta name=\"color-scheme\" content=\"dark\">"
  - "un único <meta name=\"theme-color\"> con el valor del fondo oscuro"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-019 — Con «Oscuro» el documento declara el esquema y el color de barra oscuros

## Intención

Verifica el requirement «Barra del navegador acorde al tema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado cookie pfos_theme=dark
Cuando el OWNER abre Transacciones y se lee el HTML crudo
Entonces <meta name="color-scheme" content="dark">
  Y un único <meta name="theme-color"> con el valor del fondo oscuro
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
