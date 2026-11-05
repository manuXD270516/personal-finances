---
id: TC-REPORTING-REPORTS-010
title: "La comparación con el periodo anterior y con el año anterior informa variación absoluta, porcentual y \"nuevo\""
spec: reporting/financial-reports
related_specs: []
requirement: "Comparación con el periodo anterior y con el mismo periodo del año anterior"
scenario: "Octubre contra septiembre"
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
  - packages/contexts/reporting/src/domain/report-periods.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["comparison"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Gasto consolidado: 2025-10 4000.00 BOB; 2026-09 3000.00 BOB; 2026-10 3800.00 BOB"
  - "\"Mascotas\": 0.00 en 2026-09 y 150.00 BOB en 2026-10"
input:
  compare: "PREVIOUS_PERIOD | PREVIOUS_YEAR"
steps:
  - "Comparar 2026-10 con el periodo anterior"
  - "Comparar 2026-10 con el año anterior"
expected_result:
  - "MoM: +800.00 BOB y 26.67 %"
  - "YoY: −200.00 BOB y −5.00 %"
  - "\"Mascotas\": +150.00 BOB marcado como nuevo, sin porcentaje"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-010 — La comparación con el periodo anterior y con el año anterior informa variación absoluta, porcentual y "nuevo"

## Intención

FR-REPORTING-009: comparaciones con redondeo determinista y sin divisiones por cero.

## Escenario

```gherkin
Dado un gasto de 3000.00 BOB en 2026-09 y 3800.00 BOB en 2026-10
Cuando se compara 2026-10 con el periodo anterior
Entonces la variación es 800.00 BOB y 26.67 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
