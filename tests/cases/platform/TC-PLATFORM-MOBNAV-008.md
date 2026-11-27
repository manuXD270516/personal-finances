---
id: TC-PLATFORM-MOBNAV-008
title: "Elegir una sección del cajón la abre y deja el cajón cerrado"
spec: platform/web-interface
related_specs: []
requirement: "Cajón «Más» con las secciones agrupadas"
scenario: "Ir a una sección desde el cajón"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "drawer"]
error_code: null
preconditions:
  - "cajón «Más» abierto a 360 px"
input: {}
steps:
  - "con el cajón abierto, el OWNER elige Reportes"
expected_result:
  - "la URL es /reportes"
  - "el cajón no está abierto"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-008 — Elegir una sección del cajón la abre y deja el cajón cerrado

## Intención

Verifica el requirement «Cajón «Más» con las secciones agrupadas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado cajón «Más» abierto a 360 px
Cuando con el cajón abierto, el OWNER elige Reportes
Entonces la URL es /reportes
  Y el cajón no está abierto
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
