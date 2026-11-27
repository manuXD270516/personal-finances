---
id: TC-PLATFORM-PERCEIVED-014
title: "Valor exacto de un punto del gráfico"
spec: platform/web-interface
related_specs: []
requirement: "Explicaciones accesibles sin depender del puntero"
scenario: "Valor exacto de un punto del gráfico"
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
tags: ["charts", "a11y"]
error_code: null
preconditions:
  - "OWNER con sesión y gastos que suman 1234.56 BOB en un mes"
input: {}
steps:
  - "el OWNER abre el reporte de gastos con un mes de 1234.56 BOB"
expected_result:
  - "la tabla alternativa del gráfico muestra «Bs 1.234,56» para ese mes"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-014 — Valor exacto de un punto del gráfico

## Intención

Verifica el requirement «Explicaciones accesibles sin depender del puntero» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado OWNER con sesión y gastos que suman 1234.56 BOB en un mes
Cuando el OWNER abre el reporte de gastos con un mes de 1234.56 BOB
Entonces la tabla alternativa del gráfico muestra «Bs 1.234,56» para ese mes
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
