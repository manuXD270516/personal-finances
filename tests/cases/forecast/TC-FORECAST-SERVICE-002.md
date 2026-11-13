---
id: TC-FORECAST-SERVICE-002
title: "Con la función deshabilitada la consulta lo informa y no se programan corridas"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronóstico opcional y aislado del núcleo"
scenario: "Función deshabilitada en la instalación"
requirement_status: provisional
fr: ["FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["degradation","config"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la función de pronóstico está deshabilitada y un miembro consulta el pronóstico del workspace"
expected_result:
  - "la respuesta informa que la función no está habilitada, sin series"
  - "el trabajo programado no crea corridas"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-002 — Con la función deshabilitada la consulta lo informa y no se programan corridas

## Intención

Verifica el scenario "Función deshabilitada en la instalación" del requirement "Pronóstico opcional y aislado del núcleo" de `forecast/expense-forecasting` (FR-FORECAST-006, NFR-REL-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la función de pronóstico está deshabilitada y un miembro consulta el pronóstico del workspace
Entonces la respuesta informa que la función no está habilitada, sin series
  Y el trabajo programado no crea corridas
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
