---
id: TC-REPORTING-INSIGHT-010
title: "Una línea fija no tiene riesgo calculable"
spec: reporting/predictive-insights
related_specs: []
requirement: "Líneas sin riesgo calculable"
scenario: "Línea fija"
requirement_status: confirmed
fr: ["FR-REPORTING-020","FR-PLANNING-024"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
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
  - "\"Alquiler\" es una línea fija de 2800.00 BOB y se calcula el riesgo el 2026-11-10"
expected_result:
  - "el riesgo es NOT_AVAILABLE con motivo LINE_TYPE"
  - "las líneas de etiqueta y de ingreso no figuran en la respuesta"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-010 — Una línea fija no tiene riesgo calculable

## Intención

Verifica el scenario "Línea fija" del requirement "Líneas sin riesgo calculable" de `reporting/predictive-insights` (FR-REPORTING-020, FR-PLANNING-024).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Alquiler" es una línea fija de 2800.00 BOB y se calcula el riesgo el 2026-11-10
Entonces el riesgo es NOT_AVAILABLE con motivo LINE_TYPE
Y las líneas de etiqueta y de ingreso no figuran en la respuesta
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
