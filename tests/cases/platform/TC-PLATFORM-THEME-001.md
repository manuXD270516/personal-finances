---
id: TC-PLATFORM-THEME-001
title: "Sin preferencia guardada, Inicio sigue al sistema en oscuro"
spec: platform/web-interface
related_specs: []
requirement: "Tema según la preferencia del sistema"
scenario: "Sistema en oscuro sin preferencia guardada"
requirement_status: confirmed
fr: []
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
tags: ["theme", "dark-mode"]
error_code: null
preconditions:
  - "perfil del OWNER sin preferences.theme"
  - "sin cookie pfos_theme"
input: {}
steps:
  - "el OWNER abre Inicio con colorScheme dark en Playwright"
expected_result:
  - "el fondo calculado de body es el del tema oscuro y el texto el claro"
  - "color-scheme calculado de html incluye dark (controles nativos en oscuro)"
  - "captura a 360 px y a 1280 px adjuntada al informe"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-THEME-001 — Sin preferencia guardada, Inicio sigue al sistema en oscuro

## Intención

Verifica el requirement «Tema según la preferencia del sistema» del change `add-dark-theme` (lote L3 de docs/78).

## Escenario

```gherkin
Dado perfil del OWNER sin preferences.theme
  Y sin cookie pfos_theme
Cuando el OWNER abre Inicio con colorScheme dark en Playwright
Entonces el fondo calculado de body es el del tema oscuro y el texto el claro
  Y color-scheme calculado de html incluye dark (controles nativos en oscuro)
  Y captura a 360 px y a 1280 px adjuntada al informe
```

## Notas

- Change `add-dark-theme` (lote L3, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
