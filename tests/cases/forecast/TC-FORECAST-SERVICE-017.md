---
id: TC-FORECAST-SERVICE-017
title: "Una categoría esporádica se suma en Otras categorías de su grupo"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Categorías con pocos movimientos agrupadas"
scenario: "Categoría esporádica"
requirement_status: provisional
fr: ["FR-FORECAST-001","FR-FORECAST-005"]
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
tags: ["readiness"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la categoría \"Regalos\" del grupo \"Personal\" tiene 1 transacción en 6 de sus 8 periodos y 9 transacciones en total"
expected_result:
  - "\"Regalos\" no tiene serie propia y su gasto se suma en \"Otras categorías\" de \"Personal\""
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-017 — Una categoría esporádica se suma en Otras categorías de su grupo

## Intención

Verifica el scenario "Categoría esporádica" del requirement "Categorías con pocos movimientos agrupadas" de `forecast/expense-forecasting` (FR-FORECAST-001, FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la categoría "Regalos" del grupo "Personal" tiene 1 transacción en 6 de sus 8 periodos y 9 transacciones en total
Entonces "Regalos" no tiene serie propia y su gasto se suma en "Otras categorías" de "Personal"
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
