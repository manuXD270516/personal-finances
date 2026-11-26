---
id: TC-PLATFORM-MOBNAV-007
title: "Escape cierra el cajón y devuelve el foco a «Más»"
spec: platform/web-interface
related_specs: []
requirement: "Cajón «Más» con las secciones agrupadas"
scenario: "Cerrar con Escape"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "drawer", "focus"]
error_code: null
preconditions:
  - "cajón «Más» abierto a 360 px"
input: {}
steps:
  - "con el cajón abierto, el OWNER pulsa Escape"
expected_result:
  - "el cajón no está abierto"
  - "el foco está en «Más»"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-007 — Escape cierra el cajón y devuelve el foco a «Más»

## Intención

Verifica el requirement «Cajón «Más» con las secciones agrupadas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado cajón «Más» abierto a 360 px
Cuando con el cajón abierto, el OWNER pulsa Escape
Entonces el cajón no está abierto
  Y el foco está en «Más»
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
