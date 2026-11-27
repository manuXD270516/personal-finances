---
id: TC-PLATFORM-THEME-018
title: "No quedan colores literales fuera de la hoja de tokens"
spec: platform/web-interface
related_specs: []
requirement: "Colores de la interfaz solo desde el tema"
scenario: "Sin colores fijos fuera del tema"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-103"]
invariants: []
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/colors.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "tokens", "static"]
error_code: null
preconditions:
  - "apps/web en el estado del change"
input: {}
steps:
  - "el test recorre src/**/*.{ts,tsx} y src/**/*.css de apps/web buscando hexadecimales, rgb() y hsl() literales"
expected_result:
  - "solo app/globals.css define colores literales"
  - "el bloque de tokens de .pf-home ya no existe"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-018 — No quedan colores literales fuera de la hoja de tokens

## Intención

Verifica el requirement «Colores de la interfaz solo desde el tema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado apps/web en el estado del change
Cuando el test recorre src/**/*.{ts,tsx} y src/**/*.css de apps/web buscando hexadecimales, rgb() y hsl() literales
Entonces solo app/globals.css define colores literales
  Y el bloque de tokens de .pf-home ya no existe
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
