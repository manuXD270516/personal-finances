---
id: TC-PLATFORM-TABLES-001
title: "El cronograma de un préstamo es una región con nombre que se desplaza con el teclado"
spec: platform/web-interface
related_specs: []
requirement: "Tablas desplazables con nombre y alcanzables por teclado"
scenario: "Cronograma de un préstamo en el teléfono"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "keyboard", "a11y"]
error_code: null
preconditions:
  - "un préstamo de 12000.00 BOB a 36 cuotas"
input:
  principal: "12000.00"
  moneda: "BOB"
  cuotas: 36
steps:
  - "a 360 px el OWNER abre el cronograma"
  - "pulsa Tab hasta la región de la tabla"
  - "pulsa la flecha derecha"
expected_result:
  - "la región tiene role region y el nombre del caption"
  - "la región recibe el foco"
  - "scrollLeft de la región aumenta"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-001 — El cronograma de un préstamo es una región con nombre que se desplaza con el teclado

## Intención

Verifica el requirement «Tablas desplazables con nombre y alcanzables por teclado» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un préstamo de 12000.00 BOB a 36 cuotas
Cuando a 360 px el OWNER abre el cronograma
  Y pulsa Tab hasta la región de la tabla
  Y pulsa la flecha derecha
Entonces la región tiene role region y el nombre del caption
  Y la región recibe el foco
  Y scrollLeft de la región aumenta
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
