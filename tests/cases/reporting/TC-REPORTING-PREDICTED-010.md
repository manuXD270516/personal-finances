---
id: TC-REPORTING-PREDICTED-010
title: "La tarjeta Q8 muestra la probabilidad de déficit aparte del riesgo"
spec: reporting/dashboard
related_specs: []
requirement: "Probabilidad de déficit en la tarjeta de Q8"
scenario: "Déficit posible en el Home"
requirement_status: provisional
fr: ["FR-FORECAST-008","FR-REPORTING-015"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["home","ui"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el riesgo de la serie principal es `NONE` en todas las monedas y la probabilidad de déficit con el gasto predicho es posible en BOB con fecha 2026-12-14"
expected_result:
  - "la tarjeta de Q8 muestra que los pagos conocidos no tienen riesgo y, aparte, un déficit posible en BOB el 2026-12-14 si el gasto variable es alto"
created: 2026-11-12
updated: 2026-11-12
---

# TC-REPORTING-PREDICTED-010 — La tarjeta Q8 muestra la probabilidad de déficit aparte del riesgo

## Intención

Verifica el scenario "Déficit posible en el Home" del requirement "Probabilidad de déficit en la tarjeta de Q8" de `reporting/dashboard` (FR-FORECAST-008, FR-REPORTING-015).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el riesgo de la serie principal es `NONE` en todas las monedas y la probabilidad de déficit con el gasto predicho es posible en BOB con fecha 2026-12-14
Entonces la tarjeta de Q8 muestra que los pagos conocidos no tienen riesgo y, aparte, un déficit posible en BOB el 2026-12-14 si el gasto variable es alto
```

## Notas

- Change `add-predicted-cash-flow-band` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
