---
id: TC-CLASSIFICATION-MERGE-014
title: "Octubre cerrado conserva Super y noviembre pasa a Supermercado"
spec: classification/categories
related_specs: ["planning/month-closing","reporting/financial-reports"]
requirement: "Fusión de categorías y periodos cerrados"
scenario: "Octubre cerrado y noviembre abierto"
requirement_status: provisional
fr: ["FR-CLASSIFICATION-007","FR-PLANNING-005"]
nfr: []
invariants: ["INV-019"]
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["merge","categories","closed-periods"]
error_code: null
preconditions:
  - "Workspace \"W1\" en BOB, día de inicio 1; octubre de 2026 cerrado con snapshot y noviembre abierto"
  - "\"Super\" con un gasto de 100.00 BOB en octubre y gastos que suman 320.50 BOB en noviembre"
input: {}
steps:
  - "se fusiona \"Super\" en \"Supermercado\""
  - "se consultan el reporte de octubre de 2026 y su snapshot de cierre"
expected_result:
  - "el gasto de octubre sigue en \"Super\"; el reporte de octubre muestra \"Super\" = 100.00 BOB, archivada y fusionada en \"Supermercado\", igual que el snapshot"
  - "los gastos de noviembre están en \"Supermercado\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-MERGE-014 — Octubre cerrado conserva Super y noviembre pasa a Supermercado

## Intención

Verifica el scenario "Octubre cerrado y noviembre abierto" del requirement "Fusión de categorías y periodos cerrados" de `classification/categories` (FR-CLASSIFICATION-007, FR-PLANNING-005).

## Escenario

```gherkin
Dado Workspace "W1" en BOB, día de inicio 1; octubre de 2026 cerrado con snapshot y noviembre abierto
Y "Super" con un gasto de 100.00 BOB en octubre y gastos que suman 320.50 BOB en noviembre
Cuando se fusiona "Super" en "Supermercado"
Y se consultan el reporte de octubre de 2026 y su snapshot de cierre
Entonces el gasto de octubre sigue en "Super"; el reporte de octubre muestra "Super" = 100.00 BOB, archivada y fusionada en "Supermercado", igual que el snapshot
Y los gastos de noviembre están en "Supermercado"
```

## Notas

- Change `add-category-and-counterparty-merge` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
