---
id: TC-REPORTING-INSIGHT-005
title: "Con la banda del pronóstico el riesgo es posible"
spec: reporting/predictive-insights
related_specs: []
requirement: "Banda del pronóstico en el riesgo"
scenario: "Riesgo posible con la banda"
requirement_status: confirmed
fr: ["FR-REPORTING-020","FR-FORECAST-001","FR-FORECAST-004"]
nfr: []
invariants: []
priority: medium
type: integration
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
  - "Workspace \"W1 Personal Demo\" con pronósticos habilitados y plan del periodo 2026-11 en BOB"
  - "FixedClock en 2026-11-10 (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "\"Supermercado\" tiene máximo 1500.00 BOB y gastado variable 560.00 BOB"
  - "el pronóstico vigente espera para \"Supermercado\" en 2026-11 1400.00 BOB con límite superior del 80 % de 1620.00 BOB"
expected_result:
  - "la proyección es 1400.00 BOB, la proyección alta 1620.00 BOB, la base FORECAST y el riesgo POSSIBLE"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-005 — Con la banda del pronóstico el riesgo es posible

## Intención

Verifica el scenario "Riesgo posible con la banda" del requirement "Banda del pronóstico en el riesgo" de `reporting/predictive-insights` (FR-REPORTING-020, FR-FORECAST-001, FR-FORECAST-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con pronósticos habilitados y plan del periodo 2026-11 en BOB
Cuando "Supermercado" tiene máximo 1500.00 BOB y gastado variable 560.00 BOB
Y el pronóstico vigente espera para "Supermercado" en 2026-11 1400.00 BOB con límite superior del 80 % de 1620.00 BOB
Entonces la proyección es 1400.00 BOB, la proyección alta 1620.00 BOB, la base FORECAST y el riesgo POSSIBLE
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
