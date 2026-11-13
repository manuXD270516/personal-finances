---
id: TC-FORECAST-ACCURACY-002
title: "Una serie no publicada no se evalúa"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Precisión de los pronósticos frente al real"
scenario: "Serie no publicada"
requirement_status: provisional
fr: ["FR-FORECAST-009"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["accuracy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la corrida del 2026-11-01 dejó \"Gimnasio\" con datos insuficientes"
expected_result:
  - "la evaluación de 2026-11 no tiene filas para \"Gimnasio\""
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-002 — Una serie no publicada no se evalúa

## Intención

Verifica el scenario "Serie no publicada" del requirement "Precisión de los pronósticos frente al real" de `forecast/expense-forecasting` (FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la corrida del 2026-11-01 dejó "Gimnasio" con datos insuficientes
Entonces la evaluación de 2026-11 no tiene filas para "Gimnasio"
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
