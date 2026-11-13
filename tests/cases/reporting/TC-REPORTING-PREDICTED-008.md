---
id: TC-REPORTING-PREDICTED-008
title: "La banda no cambia el riesgo ni abre episodios"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Riesgo y alerta de déficit sin cambios por el pronóstico"
scenario: "Banda por debajo del umbral sin riesgo principal"
requirement_status: provisional
fr: ["FR-REPORTING-015","FR-FORECAST-008"]
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["cash-flow","shortfall","D379"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la serie principal en BOB no baja de 2600.00 BOB, la reserva mínima es 1500.00 BOB y la serie con gasto esperado baja a 1420.00 BOB"
expected_result:
  - "el nivel de riesgo en BOB es el mismo que sin la banda y no se abre ningún episodio"
  - "la probabilidad de déficit con el gasto predicho es probable"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-PREDICTED-008 — La banda no cambia el riesgo ni abre episodios

## Intención

Verifica el scenario "Banda por debajo del umbral sin riesgo principal" del requirement "Riesgo y alerta de déficit sin cambios por el pronóstico" de `reporting/cash-flow-calendar` (FR-REPORTING-015, FR-FORECAST-008).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la serie principal en BOB no baja de 2600.00 BOB, la reserva mínima es 1500.00 BOB y la serie con gasto esperado baja a 1420.00 BOB
Entonces el nivel de riesgo en BOB es el mismo que sin la banda y no se abre ningún episodio
  Y la probabilidad de déficit con el gasto predicho es probable
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
