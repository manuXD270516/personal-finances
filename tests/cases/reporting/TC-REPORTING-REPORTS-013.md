---
id: TC-REPORTING-REPORTS-013
title: "La comparación a la fecha usa los mismos días del periodo anterior acotados a su último día"
spec: reporting/financial-reports
related_specs: []
requirement: "Comparación a la fecha del periodo en curso"
scenario: "Quince días de octubre"
requirement_status: provisional
fr: ["FR-REPORTING-009", "FR-REPORTING-018"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["comparison", "to-date"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Hoy 2026-10-15; gasto 2026-10-01 → 15: 1800.00 BOB; 2026-09-01 → 15: 1500.00 BOB"
input:
  compare: "PREVIOUS_PERIOD_TO_DATE"
steps:
  - "Comparar a la fecha"
  - "Repetir con hoy 2026-10-31"
expected_result:
  - "Variación 300.00 BOB y 20.00 %"
  - "Con hoy 2026-10-31 el tramo comparado es 2026-09-01 → 2026-09-30"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-013 — La comparación a la fecha usa los mismos días del periodo anterior acotados a su último día

## Intención

Evita comparar medio mes con un mes completo (docs/14 §6).

## Escenario

```gherkin
Dado hoy 2026-10-15
Cuando se compara a la fecha con septiembre
Entonces la variación es 300.00 BOB y 20.00 %
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
