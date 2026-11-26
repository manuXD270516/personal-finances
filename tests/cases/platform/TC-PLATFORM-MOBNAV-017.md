---
id: TC-PLATFORM-MOBNAV-017
title: "Escape cierra el menú de usuario y devuelve el foco a su botón"
spec: platform/web-interface
related_specs: []
requirement: "Menú de usuario con cierre nativo"
scenario: "Cerrar el menú con Escape"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["menu", "popover", "focus"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER abre el menú de usuario"
  - "pulsa Escape"
expected_result:
  - "el menú no está visible"
  - "el foco está en el botón del menú"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-017 — Escape cierra el menú de usuario y devuelve el foco a su botón

## Intención

Verifica el requirement «Menú de usuario con cierre nativo» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER abre el menú de usuario
  Y pulsa Escape
Entonces el menú no está visible
  Y el foco está en el botón del menú
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
