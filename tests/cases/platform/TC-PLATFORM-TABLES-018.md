---
id: TC-PLATFORM-TABLES-018
title: "Un INP por encima del aviso se marca en el informe sin hacer fallar la suite"
spec: platform/web-interface
related_specs: []
requirement: "Medición de la respuesta a interacciones"
scenario: "Valor por encima del aviso"
requirement_status: confirmed
fr: []
nfr: ["NFR-PERF-004"]
invariants: []
priority: medium
type: unit
level: unit
automation_status: automated
automated_tests:
  - tests/e2e/src/inp.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["performance", "inp"]
error_code: null
preconditions:
  - "función pura del informe en tests/e2e/src"
input: {}
steps:
  - "la función que arma el informe recibe un flujo con 650 ms"
expected_result:
  - "la fila del flujo queda marcada como por encima del aviso"
  - "la función no lanza ni devuelve un estado de fallo"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-018 — Un INP por encima del aviso se marca en el informe sin hacer fallar la suite

## Intención

Verifica el requirement «Medición de la respuesta a interacciones» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado función pura del informe en tests/e2e/src
Cuando la función que arma el informe recibe un flujo con 650 ms
Entonces la fila del flujo queda marcada como por encima del aviso
  Y la función no lanza ni devuelve un estado de fallo
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
