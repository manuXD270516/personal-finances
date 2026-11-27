---
id: TC-PLATFORM-PERCEIVED-018
title: "Texto al 200 % en escritorio"
spec: platform/web-interface
related_specs: []
requirement: "Diseño que respeta el tamaño de texto del sistema"
scenario: "Texto al 200 % en escritorio"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-107", "NFR-USAB-006"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["text-scale", "responsive"]
error_code: null
preconditions:
  - "OWNER con sesión a 1280 × 800"
  - "tamaño de fuente estándar del navegador en 32 px por CDP"
input: {}
steps:
  - "el OWNER abre Transacciones a 1280 px con el tamaño de texto del navegador al 200 %"
expected_result:
  - "la página usa el diseño angosto y no tiene desplazamiento horizontal"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-018 — Texto al 200 % en escritorio

## Intención

Verifica el requirement «Diseño que respeta el tamaño de texto del sistema» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión a 1280 × 800
  Y tamaño de fuente estándar del navegador en 32 px por CDP
Cuando el OWNER abre Transacciones a 1280 px con el tamaño de texto del navegador al 200 %
Entonces la página usa el diseño angosto y no tiene desplazamiento horizontal
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
