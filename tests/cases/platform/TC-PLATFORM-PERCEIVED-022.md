---
id: TC-PLATFORM-PERCEIVED-022
title: "Informe con procesador lento"
spec: platform/web-interface
related_specs: []
requirement: "Medición de la respuesta con un procesador lento"
scenario: "Informe con procesador lento"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004", "NFR-USAB-006"]
invariants: []
priority: low
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
  - "medición de los cuatro flujos terminada con y sin el procesador ralentizado"
input: {}
steps:
  - "termina la medición de los cuatro flujos"
expected_result:
  - "el informe muestra para cada flujo el valor de escritorio y el valor con el procesador ralentizado cuatro veces"
created: 2026-11-27
updated: 2026-11-27
---

# TC-PLATFORM-PERCEIVED-022 — Informe con procesador lento

## Intención

Verifica el requirement «Medición de la respuesta con un procesador lento» del change `refine-perceived-performance` (lote L7 de docs/78).

## Escenario

```gherkin
Dado medición de los cuatro flujos terminada con y sin el procesador ralentizado
Cuando termina la medición de los cuatro flujos
Entonces el informe muestra para cada flujo el valor de escritorio y el valor con el procesador ralentizado cuatro veces
```

## Notas

- Change `refine-perceived-performance` (lote L7 de docs/78; decisiones en docs/79, preguntas en docs/85). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- Depende de la pregunta 4 de docs/85 (recomendación A).
