---
id: TC-FORECAST-SERVICE-007
title: "Un VIEWER no puede solicitar corridas"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Solicitud manual de una corrida"
scenario: "VIEWER no solicita corridas"
requirement_status: provisional
fr: ["FR-FORECAST-001","FR-FORECAST-006"]
nfr: []
invariants: []
priority: medium
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["rbac"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un VIEWER solicita una corrida"
expected_result:
  - "la solicitud se rechaza con `INSUFFICIENT_ROLE`"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-007 — Un VIEWER no puede solicitar corridas

## Intención

Verifica el scenario "VIEWER no solicita corridas" del requirement "Solicitud manual de una corrida" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un VIEWER solicita una corrida
Entonces la solicitud se rechaza con `INSUFFICIENT_ROLE`
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
