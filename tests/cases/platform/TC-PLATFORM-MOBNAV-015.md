---
id: TC-PLATFORM-MOBNAV-015
title: "A 360 px la barra superior ocupa una fila y no muestra el selector de workspace"
spec: platform/web-interface
related_specs: []
requirement: "Barra superior de una fila en pantallas angostas"
scenario: "Barra superior a 360 px"
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
tags: ["mobile", "topbar"]
error_code: null
preconditions:
  - "OWNER con \"W1 Personal Demo\" y \"W2 Other Demo\""
input: {}
steps:
  - "el OWNER abre Inicio a 360 × 800"
expected_result:
  - "el alto de la barra superior es igual a --pf-topbar-h"
  - "el selector de workspace no está en la barra superior"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-015 — A 360 px la barra superior ocupa una fila y no muestra el selector de workspace

## Intención

Verifica el requirement «Barra superior de una fila en pantallas angostas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con "W1 Personal Demo" y "W2 Other Demo"
Cuando el OWNER abre Inicio a 360 × 800
Entonces el alto de la barra superior es igual a --pf-topbar-h
  Y el selector de workspace no está en la barra superior
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
