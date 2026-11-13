---
id: TC-FORECAST-SERVICE-004
title: "Una corrida sin datos suficientes no reemplaza al pronóstico vigente"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Corrida de pronóstico con ciclo de vida"
scenario: "Corrida sin datos suficientes no reemplaza la vigente"
requirement_status: provisional
fr: ["FR-FORECAST-001","FR-FORECAST-002"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["run-lifecycle"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la corrida \"R3\" termina sin ninguna serie con datos suficientes porque el workspace eliminó su historia importada"
expected_result:
  - "\"R3\" queda sin datos suficientes con el motivo de cada serie"
  - "\"R2\" sigue siendo el pronóstico vigente"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-004 — Una corrida sin datos suficientes no reemplaza al pronóstico vigente

## Intención

Verifica el scenario "Corrida sin datos suficientes no reemplaza la vigente" del requirement "Corrida de pronóstico con ciclo de vida" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-002).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la corrida "R3" termina sin ninguna serie con datos suficientes porque el workspace eliminó su historia importada
Entonces "R3" queda sin datos suficientes con el motivo de cada serie
  Y "R2" sigue siendo el pronóstico vigente
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
