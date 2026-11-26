---
id: TC-PLATFORM-TABLES-013
title: "Ordenar con Enter mantiene el foco en el botón del encabezado"
spec: platform/web-interface
related_specs: []
requirement: "Orden por columna en tablas comparativas"
scenario: "Ordenar con el teclado"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-102"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["tables", "sort", "keyboard"]
error_code: null
preconditions:
  - "reporte de gastos por categoría con 3 filas"
input: {}
steps:
  - "el OWNER llega con Tab al botón Categoría y pulsa Enter"
expected_result:
  - "la tabla queda ordenada por Categoría"
  - "el foco sigue en el botón Categoría"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-013 — Ordenar con Enter mantiene el foco en el botón del encabezado

## Intención

Verifica el requirement «Orden por columna en tablas comparativas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado reporte de gastos por categoría con 3 filas
Cuando el OWNER llega con Tab al botón Categoría y pulsa Enter
Entonces la tabla queda ordenada por Categoría
  Y el foco sigue en el botón Categoría
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
