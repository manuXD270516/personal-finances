---
id: TC-PLATFORM-THEME-005
title: "Volver a «Sistema» quita el tema propio y sigue al sistema"
spec: platform/web-interface
related_specs: []
requirement: "Preferencia de tema en Preferencias"
scenario: "Volver a seguir al sistema"
requirement_status: confirmed
fr: ["FR-IDENTITY-003"]
nfr: ["NFR-USAB-103"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/dark-theme.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["theme", "preferences"]
error_code: null
preconditions:
  - "perfil con tema «Oscuro»"
  - "colorScheme light"
input: {}
steps:
  - "el EDITOR elige «Sistema» en Preferencias y guarda"
expected_result:
  - "la página pasa a claro"
  - "preferences.theme = \"system\" en /me"
  - "la cookie pfos_theme ya no existe"
created: 2026-11-25
updated: 2026-11-27
---

# TC-PLATFORM-THEME-005 — Volver a «Sistema» quita el tema propio y sigue al sistema

## Intención

Verifica el requirement «Preferencia de tema en Preferencias» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado perfil con tema «Oscuro»
  Y colorScheme light
Cuando el EDITOR elige «Sistema» en Preferencias y guarda
Entonces la página pasa a claro
  Y preferences.theme = "system" en /me
  Y la cookie pfos_theme ya no existe
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
