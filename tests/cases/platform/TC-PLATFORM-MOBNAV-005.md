---
id: TC-PLATFORM-MOBNAV-005
title: "«Más» indica que la sección actual está dentro del cajón"
spec: platform/web-interface
related_specs: []
requirement: "Barra de navegación inferior en pantallas angostas"
scenario: "Sección actual dentro de «Más»"
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
tags: ["mobile", "navigation", "a11y"]
error_code: null
preconditions:
  - "OWNER con sesión"
input: {}
steps:
  - "el OWNER abre /reportes a 360 px"
expected_result:
  - "«Más» tiene la marca visual de actual"
  - "el nombre accesible de «Más» incluye \"Reportes\" (es, en y pt)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-MOBNAV-005 — «Más» indica que la sección actual está dentro del cajón

## Intención

Verifica el requirement «Barra de navegación inferior en pantallas angostas» del change `refine-mobile-navigation` (lote L4 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión
Cuando el OWNER abre /reportes a 360 px
Entonces «Más» tiene la marca visual de actual
  Y el nombre accesible de «Más» incluye "Reportes" (es, en y pt)
```

## Notas

- Change `refine-mobile-navigation` (lote L4, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
