---
id: TC-REPORTING-INSIGHT-002
title: "Un ritmo dentro del tope da riesgo improbable"
spec: reporting/predictive-insights
related_specs: []
requirement: "Riesgo de exceder una línea de gasto"
scenario: "Ritmo dentro del tope"
requirement_status: provisional
fr: ["FR-REPORTING-020","FR-PLANNING-024"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["budget-risk"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; pronósticos deshabilitados salvo que el escenario diga otro"
input: {}
steps:
  - "\"Supermercado\" tiene máximo 1500.00 BOB y gastado 400.00 BOB"
  - "se calcula el riesgo el 2026-11-10"
expected_result:
  - "la proyección es 1200.00 BOB y el riesgo es UNLIKELY"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-INSIGHT-002 — Un ritmo dentro del tope da riesgo improbable

## Intención

Verifica el scenario "Ritmo dentro del tope" del requirement "Riesgo de exceder una línea de gasto" de `reporting/predictive-insights` (FR-REPORTING-020, FR-PLANNING-024).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz, día de inicio del mes financiero 1 y plan del periodo 2026-11 (2026-11-01 a 2026-11-30) en BOB
Cuando "Supermercado" tiene máximo 1500.00 BOB y gastado 400.00 BOB
Y se calcula el riesgo el 2026-11-10
Entonces la proyección es 1200.00 BOB y el riesgo es UNLIKELY
```

## Notas

- Change `add-budget-overrun-risk` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
