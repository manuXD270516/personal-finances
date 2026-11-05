---
id: TC-REPORTING-REPORTS-012
title: "El promedio móvil de 3 periodos completos sirve de línea base y avisa el historial insuficiente"
spec: reporting/financial-reports
related_specs: []
requirement: "Promedio móvil de periodos completos"
scenario: "Promedio de tres meses"
requirement_status: confirmed
fr: ["FR-REPORTING-009"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["rolling"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Gasto: 2026-07 3000.00, 2026-08 3300.00, 2026-09 3000.00, 2026-10 3800.00 BOB"
  - "Caso aparte: primer movimiento del workspace el 2026-08-03"
input:
  rolling: "3"
steps:
  - "Calcular el promedio móvil de 3 para 2026-10"
expected_result:
  - "Línea base 3100.00 BOB; variación 700.00 BOB y 22.58 %"
  - "Con el primer movimiento el 2026-08-03: historial insuficiente, sin variación"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-012 — El promedio móvil de 3 periodos completos sirve de línea base y avisa el historial insuficiente

## Intención

Una línea base no debe inventar periodos anteriores al inicio del workspace.

## Escenario

```gherkin
Dado gastos de 3000.00, 3300.00 y 3000.00 BOB en jul–sep
Cuando se pide el promedio móvil de 3 para 2026-10
Entonces la línea base es 3100.00 BOB y la variación 700.00 BOB y 22.58 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
