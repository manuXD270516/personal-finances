---
id: TC-PLATFORM-TABLES-020
title: "La decisión sobre una fila se conserva al cambiar de página"
spec: platform/web-interface
related_specs: ["imports/import-pipeline"]
requirement: "Vista previa del import por páginas"
scenario: "Decisión conservada entre páginas"
requirement_status: confirmed
fr: ["FR-IMPORTS-002"]
nfr: ["NFR-USAB-102"]
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
  - "un import en vista previa con 450 filas; la fila 10 es un gasto de 60.00 BOB"
input:
  monto: "60.00"
  moneda: "BOB"
steps:
  - "el OWNER marca como duplicada la fila 10"
  - "pasa a la página 2 y vuelve a la 1"
expected_result:
  - "la fila 10 sigue marcada como duplicada (aria-pressed y texto)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-020 — La decisión sobre una fila se conserva al cambiar de página

## Intención

Verifica el requirement «Vista previa del import por páginas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un import en vista previa con 450 filas; la fila 10 es un gasto de 60.00 BOB
Cuando el OWNER marca como duplicada la fila 10
  Y pasa a la página 2 y vuelve a la 1
Entonces la fila 10 sigue marcada como duplicada (aria-pressed y texto)
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
