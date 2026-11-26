---
id: TC-PLATFORM-MOBNAV-013
title: "La barra inferior se oculta con un campo enfocado y vuelve al salir"
spec: platform/web-interface
related_specs: []
requirement: "Barra inferior oculta mientras se escribe"
scenario: "Escribir en la búsqueda"
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
tags: ["mobile", "keyboard"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "a 360 px el OWNER enfoca la búsqueda de Transacciones"
  - "pulsa Tab hasta un enlace"
expected_result:
  - "con la búsqueda enfocada la barra inferior no está visible"
  - "con el enlace enfocado la barra inferior está visible"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-013 — La barra inferior se oculta con un campo enfocado y vuelve al salir

## Intención

Verifica el requirement «Barra inferior oculta mientras se escribe» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando a 360 px el OWNER enfoca la búsqueda de Transacciones
  Y pulsa Tab hasta un enlace
Entonces con la búsqueda enfocada la barra inferior no está visible
  Y con el enlace enfocado la barra inferior está visible
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
