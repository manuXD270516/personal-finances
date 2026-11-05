---
id: TC-REPORTING-REPORTS-005
title: "Ingresos y gastos de octubre con un gasto en dólares, tasa de ahorro sin definir y granularidad semanal"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de ingresos y gastos"
scenario: "Octubre con un gasto en dólares"
requirement_status: provisional
fr: ["FR-REPORTING-008"]
nfr: []
invariants: ["INV-012", "INV-020"]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["income-expenses"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Sueldo 12000.00 BOB; gastos 3500.00 BOB en \"Supermercado\"; reembolso 200.00 BOB; 50.00 USD en \"Restaurantes\" el 2026-10-15"
  - "Tasa USD/BOB 10.00 al cierre del 2026-10-15"
  - "En 2026-11 sin ingresos y gasto de 150.00 BOB"
input:
  granularity: "PERIOD | WEEK"
steps:
  - "Calcular el reporte de 2026-10 y 2026-11"
  - "Calcular 2026-10 por semana"
expected_result:
  - "BOB nativo: ingreso 12000.00, gasto 3300.00; USD nativo: gasto 50.00"
  - "Consolidado BOB: ingreso 12000.00, gasto 3800.00, ahorro 8200.00, tasa 68.3 %"
  - "2026-11: ahorro −150.00 BOB y tasa de ahorro sin definir (null)"
  - "Semana 2026-10-12 → 2026-10-18: gasto consolidado 500.00 BOB"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-005 — Ingresos y gastos de octubre con un gasto en dólares, tasa de ahorro sin definir y granularidad semanal

## Intención

Reporte Must 1: responde "¿gano más de lo que gasto?" con cifras exactas por moneda.

## Escenario

```gherkin
Dado un sueldo de 12000.00 BOB, gastos netos de 3300.00 BOB y 50.00 USD a 10.00
Cuando se pide el reporte de 2026-10
Entonces el consolidado informa ingreso 12000.00, gasto 3800.00, ahorro 8200.00 BOB y 68.3 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
