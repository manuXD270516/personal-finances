---
id: TC-PLATFORM-MOBNAV-018
title: "Un clic fuera cierra el menú de usuario"
spec: platform/web-interface
related_specs: []
requirement: "Menú de usuario con cierre nativo"
scenario: "Cerrar el menú con un clic fuera"
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
tags: ["menu", "popover"]
error_code: null
preconditions:
  - "menú de usuario abierto"
input: {}
steps:
  - "con el menú abierto, el OWNER hace clic en el contenido principal"
expected_result:
  - "el menú no está visible"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-018 — Un clic fuera cierra el menú de usuario

## Intención

Verifica el requirement «Menú de usuario con cierre nativo» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado menú de usuario abierto
Cuando con el menú abierto, el OWNER hace clic en el contenido principal
Entonces el menú no está visible
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
