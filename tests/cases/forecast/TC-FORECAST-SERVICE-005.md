---
id: TC-FORECAST-SERVICE-005
title: "Un EDITOR solicita una corrida y recibe la operación asíncrona auditada"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Solicitud manual de una corrida"
scenario: "EDITOR solicita una corrida"
requirement_status: provisional
fr: ["FR-FORECAST-001","FR-FORECAST-006"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["manual-run","audit"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un EDITOR solicita una corrida y el workspace no tiene ninguna activa"
expected_result:
  - "la respuesta es aceptada con la operación de la corrida en estado pendiente"
  - "la auditoría registra la solicitud con el EDITOR como actor"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-005 — Un EDITOR solicita una corrida y recibe la operación asíncrona auditada

## Intención

Verifica el scenario "EDITOR solicita una corrida" del requirement "Solicitud manual de una corrida" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un EDITOR solicita una corrida y el workspace no tiene ninguna activa
Entonces la respuesta es aceptada con la operación de la corrida en estado pendiente
  Y la auditoría registra la solicitud con el EDITOR como actor
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
