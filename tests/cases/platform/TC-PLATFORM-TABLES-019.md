---
id: TC-PLATFORM-TABLES-019
title: "La vista previa de 450 filas se recorre por páginas con el foco al inicio de la tabla"
spec: platform/web-interface
related_specs: ["imports/import-pipeline"]
requirement: "Vista previa del import por páginas"
scenario: "Extracto de 450 filas"
requirement_status: confirmed
fr: ["FR-IMPORTS-002"]
nfr: ["NFR-PERF-004", "NFR-USAB-102"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: deprecated
deprecated_by_change: refine-data-tables
deprecation_reason: "La medición de INP con 2 000 filas no confirma el problema (mediana de abrir fila 200 ms y de filtrar 140 ms, bajo el objetivo de 200 ms; ver tasks 6.1): no se pagina la vista previa y el requirement se retira (docs/82, pregunta 7, recomendación)."
regression_suite: false
phase: 9
tags: ["imports", "pagination"]
error_code: null
preconditions:
  - "un import en vista previa con 450 filas sintéticas"
input: {}
steps:
  - "el OWNER abre la vista previa"
  - "pulsa «Siguiente»"
expected_result:
  - "la tabla tiene 200 filas y el texto \"Filas 1–200 de 450\""
  - "tras «Siguiente» las filas son 201 a 400 y el foco está en la región de la tabla"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-019 — La vista previa de 450 filas se recorre por páginas con el foco al inicio de la tabla

## Intención

Verifica el requirement «Vista previa del import por páginas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un import en vista previa con 450 filas sintéticas
Cuando el OWNER abre la vista previa
  Y pulsa «Siguiente»
Entonces la tabla tiene 200 filas y el texto "Filas 1–200 de 450"
  Y tras «Siguiente» las filas son 201 a 400 y el foco está en la región de la tabla
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
