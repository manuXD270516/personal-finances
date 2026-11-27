---
id: TC-PLATFORM-PERCEIVED-011
title: "Explicación con el teclado"
spec: platform/web-interface
related_specs: []
requirement: "Explicaciones accesibles sin depender del puntero"
scenario: "Explicación con el teclado"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-101", "NFR-USAB-102", "NFR-USAB-105", "NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["toggletip", "keyboard", "a11y"]
error_code: null
preconditions:
  - "EDITOR con sesión y una transacción conciliada sin extracto"
input: {}
steps:
  - "en Transacciones el EDITOR llega con Tab al botón de información de una transacción conciliada sin extracto y pulsa Enter"
expected_result:
  - "se abre la explicación de por qué aparece así"
  - "Escape la cierra y devuelve el foco al botón"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-011 — Explicación con el teclado

## Intención

Verifica el requirement «Explicaciones accesibles sin depender del puntero» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado EDITOR con sesión y una transacción conciliada sin extracto
Cuando en Transacciones el EDITOR llega con Tab al botón de información de una transacción conciliada sin extracto y pulsa Enter
Entonces se abre la explicación de por qué aparece así
  Y Escape la cierra y devuelve el foco al botón
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
