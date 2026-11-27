---
id: TC-PLATFORM-TABLES-021
title: "Cambiar el filtro vuelve a la primera página"
spec: platform/web-interface
related_specs: ["imports/import-pipeline"]
requirement: "Vista previa del import por páginas"
scenario: "Cambiar el filtro"
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
  - "un import en vista previa con 450 filas"
input: {}
steps:
  - "en la página 2, el OWNER filtra por las filas sin categoría"
expected_result:
  - "la vista previa muestra la página 1 del filtro"
  - "el texto de posición empieza en \"Filas 1–\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-021 — Cambiar el filtro vuelve a la primera página

## Intención

Verifica el requirement «Vista previa del import por páginas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado un import en vista previa con 450 filas
Cuando en la página 2, el OWNER filtra por las filas sin categoría
Entonces la vista previa muestra la página 1 del filtro
  Y el texto de posición empieza en "Filas 1–"
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
