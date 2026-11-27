---
id: TC-REPORTING-INSIGHT-006
title: "Con los pronósticos deshabilitados se usa el ritmo y no hay riesgo posible"
spec: reporting/predictive-insights
related_specs: []
requirement: "Banda del pronóstico en el riesgo"
scenario: "Pronósticos deshabilitados"
requirement_status: confirmed
fr: ["FR-REPORTING-020","FR-FORECAST-004"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/budget-risk.queries.test.ts
  - packages/contexts/reporting/src/domain/budget-overrun-projector.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "FORECASTING_ENABLED=false y \"Supermercado\" tiene máximo 1500.00 BOB y gastado 560.00 BOB"
  - "se calcula el riesgo el 2026-11-10"
expected_result:
  - "la proyección es 1680.00 BOB, la base RUN_RATE, el riesgo LIKELY y projectedHigh null"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-006 — Con los pronósticos deshabilitados se usa el ritmo y no hay riesgo posible

## Intención

Verifica el scenario "Pronósticos deshabilitados" del requirement "Banda del pronóstico en el riesgo" de `reporting/predictive-insights` (FR-REPORTING-020, FR-FORECAST-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando FORECASTING_ENABLED=false y "Supermercado" tiene máximo 1500.00 BOB y gastado 560.00 BOB
Y se calcula el riesgo el 2026-11-10
Entonces la proyección es 1680.00 BOB, la base RUN_RATE, el riesgo LIKELY y projectedHigh null
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
