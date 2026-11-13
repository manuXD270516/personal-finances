---
id: TC-FORECAST-SERVICE-035
title: "Los registros del servicio no contienen montos de las series"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Servicio de pronósticos autenticado y sin acceso a datos"
scenario: "Registros sin montos"
requirement_status: provisional
fr: []
nfr: ["NFR-SEC-007","NFR-SEC-014","NFR-COMP-001"]
invariants: []
priority: high
type: security
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["privacy","logs"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el servicio procesa una petición con la serie del gasto total"
expected_result:
  - "sus registros informan la cantidad de series y puntos y la duración, sin ningún monto"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-035 — Los registros del servicio no contienen montos de las series

## Intención

Verifica el scenario "Registros sin montos" del requirement "Servicio de pronósticos autenticado y sin acceso a datos" de `forecast/expense-forecasting` (NFR-SEC-007, NFR-SEC-014, NFR-COMP-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el servicio procesa una petición con la serie del gasto total
Entonces sus registros informan la cantidad de series y puntos y la duración, sin ningún monto
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
