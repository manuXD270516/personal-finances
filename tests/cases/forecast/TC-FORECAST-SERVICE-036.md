---
id: TC-FORECAST-SERVICE-036
title: "Al completarse una corrida se publica una vez el hecho de pronóstico generado sin montos"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Hecho de pronóstico generado"
scenario: "Corrida completada"
requirement_status: confirmed
fr: ["FR-FORECAST-002"]
nfr: ["NFR-REL-008"]
invariants: []
priority: medium
type: integration
level: event-contract
automation_status: automated
automated_tests:
  - apps/api/test/api/forecasting.api.test.ts
  - packages/contexts/forecasting/src/application/forecasting.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["outbox"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la corrida \"R2\" se completa con 18 series publicadas y 4 con datos insuficientes"
expected_result:
  - "se publica una sola vez el hecho de pronóstico generado de \"R2\" con esas cantidades y sin montos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-036 — Al completarse una corrida se publica una vez el hecho de pronóstico generado sin montos

## Intención

Verifica el scenario "Corrida completada" del requirement "Hecho de pronóstico generado" de `forecast/expense-forecasting` (FR-FORECAST-002, NFR-REL-008).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la corrida "R2" se completa con 18 series publicadas y 4 con datos insuficientes
Entonces se publica una sola vez el hecho de pronóstico generado de "R2" con esas cantidades y sin montos
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
