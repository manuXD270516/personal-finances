---
id: TC-REPORTING-REPORTS-018
title: "El drill-down de una categoría lista sus porciones y su suma es igual a la cifra"
spec: reporting/financial-reports
related_specs: []
requirement: "Drill-down de una celda a sus porciones"
scenario: "Supermercado de octubre"
requirement_status: provisional
fr: ["FR-REPORTING-010"]
nfr: []
invariants: ["INV-021"]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["drill-down"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "\"Supermercado\" 2026-10: gasto 3500.00 BOB y reembolso 200.00 BOB"
  - "Compra de 600.00 BOB el 2026-11-03 repartida 400.00 \"Supermercado\" y 200.00 \"Farmacia\""
input:
  report: "EXPENSES_BY_CATEGORY"
steps:
  - "Abrir el drill-down de \"Supermercado\" 2026-10"
  - "Abrir el drill-down de \"Supermercado\" 2026-11"
expected_result:
  - "2026-10: 2 porciones 3500.00 y −200.00 BOB; Σ = 3300.00 BOB (nativo y consolidado)"
  - "2026-11: 1 porción de 400.00 BOB con enlace a la transacción de 600.00 BOB"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-018 — El drill-down de una categoría lista sus porciones y su suma es igual a la cifra

## Intención

FR-REPORTING-010: toda cifra se explica hasta las porciones que la componen.

## Escenario

```gherkin
Dado "Supermercado" con 3300.00 BOB en 2026-10
Cuando se abre su drill-down
Entonces se listan 3500.00 y −200.00 BOB que suman 3300.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
