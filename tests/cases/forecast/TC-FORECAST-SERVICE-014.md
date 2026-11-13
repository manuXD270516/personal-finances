---
id: TC-FORECAST-SERVICE-014
title: "Una serie con 4 periodos queda como estimación simple con datos insuficientes"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Preparación de datos por serie"
scenario: "Historia de 4 periodos"
requirement_status: confirmed
fr: ["FR-FORECAST-005"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/domain/readiness-gate.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["readiness"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la categoría \"Restaurantes\" tiene datos en los periodos 2026-07 a 2026-10"
expected_result:
  - "su serie queda como estimación simple con datos insuficientes"
  - "informa que faltan 2 periodos para un modelo estadístico"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-014 — Una serie con 4 periodos queda como estimación simple con datos insuficientes

## Intención

Verifica el scenario "Historia de 4 periodos" del requirement "Preparación de datos por serie" de `forecast/expense-forecasting` (FR-FORECAST-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la categoría "Restaurantes" tiene datos en los periodos 2026-07 a 2026-10
Entonces su serie queda como estimación simple con datos insuficientes
  Y informa que faltan 2 periodos para un modelo estadístico
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
