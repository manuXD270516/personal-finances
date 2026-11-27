---
id: TC-PLATFORM-PERCEIVED-005
title: "Informe de la medición"
spec: platform/web-interface
related_specs: []
requirement: "Respuesta a la interacción sin empeorar"
scenario: "Informe de la medición"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004", "NFR-USAB-006"]
invariants: []
priority: medium
type: e2e
level: performance
automation_status: automated
automated_tests:
  - tests/e2e/src/inp.test.ts
  - tests/e2e/specs/inp.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["inp", "performance"]
error_code: null
preconditions:
  - "medición de los cuatro flujos terminada"
input: {}
steps:
  - "termina la medición de los cuatro flujos"
expected_result:
  - "el informe muestra cada flujo con su valor en ms y su estado frente a 200 ms y a 500 ms"
  - "la suite no falla aunque un valor supere 200 ms"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-005 — Informe de la medición

## Intención

Verifica el requirement «Respuesta a la interacción sin empeorar» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado medición de los cuatro flujos terminada
Cuando termina la medición de los cuatro flujos
Entonces el informe muestra cada flujo con su valor en ms y su estado frente a 200 ms y a 500 ms
  Y la suite no falla aunque un valor supere 200 ms
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
