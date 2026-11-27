---
id: TC-PLATFORM-PERCEIVED-012
title: "Explicación en el teléfono"
spec: platform/web-interface
related_specs: []
requirement: "Explicaciones accesibles sin depender del puntero"
scenario: "Explicación en el teléfono"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101", "NFR-USAB-102", "NFR-USAB-105", "NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/perceived-performance.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["toggletip", "mobile"]
error_code: null
preconditions:
  - "EDITOR con sesión a 360 × 800 y tasas de cambio cargadas"
input: {}
steps:
  - "a 360 px el EDITOR toca el botón de información de una tasa de cambio"
expected_result:
  - "la explicación se abre sin necesidad de un puntero"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-012 — Explicación en el teléfono

## Intención

Verifica el requirement «Explicaciones accesibles sin depender del puntero» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión a 360 × 800 y tasas de cambio cargadas
Cuando a 360 px el EDITOR toca el botón de información de una tasa de cambio
Entonces la explicación se abre sin necesidad de un puntero
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
