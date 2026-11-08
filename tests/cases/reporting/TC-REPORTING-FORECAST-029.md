---
id: TC-REPORTING-FORECAST-029
title: "Cada categoría de los tops informa su variación en valor y porcentaje, nuevo si antes era cero"
spec: reporting/dashboard
related_specs: []
requirement: "Variación por categoría frente al periodo anterior"
scenario: "Supermercado y Fees contra agosto"
requirement_status: confirmed
fr: ["FR-REPORTING-018","FR-REPORTING-004"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/cash-flow/forecast-home.test.tsx
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/category-variation.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["q7","comparison"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-09-15"
  - "Supermercado 1305.00 BOB (1–15 sep) y 1200.00 BOB (1–15 ago); Fees 5.00 BOB solo en septiembre"
input: {}
steps:
  - "Calcular el resumen con comparación a la fecha"
expected_result:
  - "Supermercado +105.00 BOB, +8.75 %, desfavorable"
  - "Fees +5.00 BOB, \"nuevo\""
created: 2026-11-04
updated: 2026-11-07
---

# TC-REPORTING-FORECAST-029 — Cada categoría de los tops informa su variación en valor y porcentaje, nuevo si antes era cero

## Intención

Q7 completo (docs/00 §6: variación de top categorías en valor y %).

## Escenario

```gherkin
Dado Supermercado 1305.00 BOB (1–15 sep) y 1200.00 BOB (1–15 ago); Fees 5.00 BOB solo en septiembre
Cuando Calcular el resumen con comparación a la fecha
Entonces Supermercado +105.00 BOB, +8.75 %, desfavorable
  Y Fees +5.00 BOB, "nuevo"
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Variación por categoría frente al periodo anterior" de `reporting/dashboard`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
