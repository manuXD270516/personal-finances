---
id: TC-PLATFORM-TABLES-012
title: "Solo la columna activa declara el orden y el cambio se anuncia una vez"
spec: platform/web-interface
related_specs: []
requirement: "Orden por columna en tablas comparativas"
scenario: "Indicador y anuncio del orden"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-108"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/sort.test.ts
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["tables", "sort", "a11y", "i18n"]
error_code: null
preconditions:
  - "reporte de gastos por categoría con 3 filas"
input: {}
steps:
  - "el OWNER ordena por Monto"
expected_result:
  - "solo el th de Monto tiene aria-sort=\"descending\""
  - "la región de estado recibe una sola vez \"Ordenado por Monto, de mayor a menor\" (es, en y pt)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-TABLES-012 — Solo la columna activa declara el orden y el cambio se anuncia una vez

## Intención

Verifica el requirement «Orden por columna en tablas comparativas» del change `refine-data-tables` (lote L5 de docs/78).

## Escenario

```gherkin
Dado reporte de gastos por categoría con 3 filas
Cuando el OWNER ordena por Monto
Entonces solo el th de Monto tiene aria-sort="descending"
  Y la región de estado recibe una sola vez "Ordenado por Monto, de mayor a menor" (es, en y pt)
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
