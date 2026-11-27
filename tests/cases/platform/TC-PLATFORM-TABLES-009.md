---
id: TC-PLATFORM-TABLES-009
title: "El borde derecho muestra la pista cuando hay columnas fuera de la vista"
spec: platform/web-interface
related_specs: []
requirement: "Pista de desplazamiento horizontal"
scenario: "Columnas fuera de la vista"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006"]
invariants: []
priority: low
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "scroll-hint"]
error_code: null
preconditions:
  - "un préstamo de 12000.00 BOB a 36 cuotas"
  - "Chromium con soporte de scroll-driven animations"
input:
  principal: "12000.00"
  moneda: "BOB"
  cuotas: 36
steps:
  - "a 360 px el OWNER abre el cronograma"
expected_result:
  - "la región tiene la máscara de desvanecido en el borde derecho"
  - "captura adjuntada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-009 — El borde derecho muestra la pista cuando hay columnas fuera de la vista

## Intención

Verifica el requirement «Pista de desplazamiento horizontal» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un préstamo de 12000.00 BOB a 36 cuotas
  Y Chromium con soporte de scroll-driven animations
Cuando a 360 px el OWNER abre el cronograma
Entonces la región tiene la máscara de desvanecido en el borde derecho
  Y captura adjuntada
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
