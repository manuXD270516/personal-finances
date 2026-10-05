---
id: TC-REPORTING-KPI-009
title: "El resumen trae el top de categorías de ingreso junto al de gasto"
spec: reporting/dashboard
related_specs: []
requirement: "Principales categorías de ingreso del mes"
scenario: "Salario y freelance"
requirement_status: confirmed
fr: ["FR-REPORTING-004"]
nfr: []
invariants: []
priority: medium
type: unit
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/reports.api.test.ts
  - packages/contexts/reporting/src/application/report-summary.queries.test.ts
  - packages/contexts/reporting/src/domain/kpi-calculator.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["kpi","categories","income"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "Mes consultado: 2026-09"
input: {"income":{"Salario":"8000.00 BOB","Freelance":"1500.00 BOB"},"expense":{"Supermercado":"1200.00 BOB"},"topCategories":5}
steps:
  - "Consultar el resumen del mes"
expected_result:
  - "topIncomeCategories: Salario 8000.00 BOB, Freelance 1500.00 BOB (en ese orden)"
  - "topExpenseCategories: solo Supermercado"
  - "Con topCategories = 1 el top de ingresos tiene una sola línea"
created: 2026-10-05
updated: 2026-10-05
---

# TC-REPORTING-KPI-009 — El resumen trae el top de categorías de ingreso junto al de gasto

## Intención

FR-REPORTING-004 pide ingresos y gastos del mes por categoría: Q2 ("¿cuánto ingresó?") necesita saber de dónde vino
el ingreso, no solo el total.

## Escenario

```gherkin
Dados ingresos Salario 8000.00 y Freelance 1500.00 BOB y un gasto Supermercado 1200.00 BOB en septiembre
Cuando consulto el resumen del mes
Entonces el top de ingresos lista Salario y Freelance en ese orden y el de gastos solo Supermercado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
