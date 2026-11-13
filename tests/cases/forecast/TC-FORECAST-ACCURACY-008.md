---
id: TC-FORECAST-ACCURACY-008
title: "Las métricas de calidad se publican sin identificadores ni montos"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Métricas de calidad del pronóstico"
scenario: "Métricas sin identificadores"
requirement_status: provisional
fr: ["FR-FORECAST-009"]
nfr: ["NFR-OBS-009"]
invariants: []
priority: medium
type: platform
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["observability"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se evalúa el periodo 2026-11 de dos workspaces"
expected_result:
  - "las métricas de error escalado y cobertura se publican por tipo de serie sin etiquetas de workspace, serie ni montos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-ACCURACY-008 — Las métricas de calidad se publican sin identificadores ni montos

## Intención

Verifica el scenario "Métricas sin identificadores" del requirement "Métricas de calidad del pronóstico" de `forecast/expense-forecasting` (NFR-OBS-009, FR-FORECAST-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se evalúa el periodo 2026-11 de dos workspaces
Entonces las métricas de error escalado y cobertura se publican por tipo de serie sin etiquetas de workspace, serie ni montos
```

## Notas

- Change `add-forecast-accuracy` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
