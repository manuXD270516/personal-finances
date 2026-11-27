---
id: TC-PLATFORM-PERCEIVED-013
title: "Navegador sin capas emergentes"
spec: platform/web-interface
related_specs: []
requirement: "Explicaciones accesibles sin depender del puntero"
scenario: "Navegador sin capas emergentes"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101", "NFR-USAB-102", "NFR-USAB-105", "NFR-USAB-006"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["toggletip", "progressive-enhancement"]
error_code: null
preconditions:
  - "componente `InfoTip` renderizado como marcado estático"
input: {}
steps:
  - "el EDITOR abre Transacciones en un navegador sin soporte de capas emergentes"
expected_result:
  - "la explicación se ve como texto junto al botón de información"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-013 — Navegador sin capas emergentes

## Intención

Verifica el requirement «Explicaciones accesibles sin depender del puntero» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado componente `InfoTip` renderizado como marcado estático
Cuando el EDITOR abre Transacciones en un navegador sin soporte de capas emergentes
Entonces la explicación se ve como texto junto al botón de información
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Sin soporte el navegador ignora el atributo `popover`: se verifica que el contenido está en el marcado junto al botón y que ninguna regla de CSS lo oculta fuera de `:popover-open`.
