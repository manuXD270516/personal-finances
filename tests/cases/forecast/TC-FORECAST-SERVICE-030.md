---
id: TC-FORECAST-SERVICE-030
title: "La corrida se completa si el servicio responde en el tercer intento"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Reintentos y falla de una corrida"
scenario: "Servicio recuperado en el tercer intento"
requirement_status: confirmed
fr: ["FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/forecasting/src/application/forecasting.test.ts
  - packages/contexts/forecasting/src/domain/forecast-run.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["retries"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el servicio no responde en los dos primeros intentos de \"R3\" y responde en el tercero"
expected_result:
  - "\"R3\" se completa y reemplaza a \"R2\""
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-030 — La corrida se completa si el servicio responde en el tercer intento

## Intención

Verifica el scenario "Servicio recuperado en el tercer intento" del requirement "Reintentos y falla de una corrida" de `forecast/expense-forecasting` (FR-FORECAST-006, NFR-REL-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el servicio no responde en los dos primeros intentos de "R3" y responde en el tercero
Entonces "R3" se completa y reemplaza a "R2"
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
