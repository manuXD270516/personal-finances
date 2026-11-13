---
id: TC-FORECAST-SERVICE-033
title: "Una corrida de otro workspace no se revela"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Consulta del pronóstico vigente"
scenario: "Corrida de otro workspace"
requirement_status: provisional
fr: ["FR-FORECAST-001","FR-FORECAST-002"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: critical
type: security
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["rls","isolation"]
error_code: RESOURCE_NOT_FOUND
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un miembro de \"W1 Personal Demo\" pide una corrida de \"W2 Familia Demo\""
expected_result:
  - "la consulta responde que el recurso no existe"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-033 — Una corrida de otro workspace no se revela

## Intención

Verifica el scenario "Corrida de otro workspace" del requirement "Consulta del pronóstico vigente" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-002, NFR-SEC-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un miembro de "W1 Personal Demo" pide una corrida de "W2 Familia Demo"
Entonces la consulta responde que el recurso no existe
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
