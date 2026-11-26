---
id: TC-PLATFORM-MOBNAV-016
title: "Cambiar de workspace desde el cajón «Más»"
spec: platform/web-interface
related_specs: ["identity/workspace-membership"]
requirement: "Barra superior de una fila en pantallas angostas"
scenario: "Cambiar de workspace desde «Más»"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["mobile", "workspace"]
error_code: null
preconditions:
  - "OWNER con \"W1 Personal Demo\" y \"W2 Other Demo\""
input: {}
steps:
  - "a 360 px el OWNER abre «Más» y elige \"W2 Other Demo\""
expected_result:
  - "el workspace activo es \"W2 Other Demo\""
  - "el comportamiento coincide con el selector de escritorio"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-016 — Cambiar de workspace desde el cajón «Más»

## Intención

Verifica el requirement «Barra superior de una fila en pantallas angostas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con "W1 Personal Demo" y "W2 Other Demo"
Cuando a 360 px el OWNER abre «Más» y elige "W2 Other Demo"
Entonces el workspace activo es "W2 Other Demo"
  Y el comportamiento coincide con el selector de escritorio
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
