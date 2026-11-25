---
id: TC-CLASSIFICATION-MERGE-001
title: "Fusionar Super en Supermercado suma 1560,50 en noviembre sin tocar el ledger"
spec: classification/categories
related_specs: ["reporting/financial-reports","ledger/journal-posting"]
requirement: "Fusionar categorías"
scenario: "Fusionar Super en Supermercado"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-CLASSIFICATION-002","FR-AUDIT-001"]
nfr: []
invariants: ["INV-019","INV-021"]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB, TZ America/La_Paz, día de inicio 1; noviembre de 2026 abierto"
  - "\"Super\" (gasto) con 3 porciones de noviembre que suman 320.50 BOB; \"Supermercado\" (gasto) con porciones de noviembre que suman 1240.00 BOB; usuario EDITOR"
input: {}
steps:
  - "se fusiona \"Super\" en \"Supermercado\""
expected_result:
  - "el reporte de gastos por categoría de noviembre de 2026 muestra \"Supermercado\" = 1560.50 BOB y no muestra \"Super\""
  - "\"Super\" queda ARCHIVED con mergedInto \"Supermercado\""
  - "el número de asientos y los saldos de las cuentas no cambian; hay un registro de auditoría con el operationId"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-001 — Fusionar Super en Supermercado suma 1560,50 en noviembre sin tocar el ledger

## Intención

Verifica el scenario "Fusionar Super en Supermercado" del requirement "Fusionar categorías" de `classification/categories` (FR-CLASSIFICATION-007, FR-CLASSIFICATION-002, FR-AUDIT-001).

## Escenario

```gherkin
Dado Workspace "W1" en BOB, TZ America/La_Paz, día de inicio 1; noviembre de 2026 abierto
Y "Super" (gasto) con 3 porciones de noviembre que suman 320.50 BOB; "Supermercado" (gasto) con porciones de noviembre que suman 1240.00 BOB; usuario EDITOR
Cuando se fusiona "Super" en "Supermercado"
Entonces el reporte de gastos por categoría de noviembre de 2026 muestra "Supermercado" = 1560.50 BOB y no muestra "Super"
Y "Super" queda ARCHIVED con mergedInto "Supermercado"
Y el número de asientos y los saldos de las cuentas no cambian; hay un registro de auditoría con el operationId
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
