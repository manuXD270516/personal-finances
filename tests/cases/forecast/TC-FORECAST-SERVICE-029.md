---
id: TC-FORECAST-SERVICE-029
title: "Con el servicio caído en los 5 intentos la corrida falla y se muestra la vigente marcada"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Reintentos y falla de una corrida"
scenario: "Servicio caído durante toda la ventana"
requirement_status: confirmed
fr: ["FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/forecasting.api.test.ts
  - packages/contexts/forecasting/src/application/forecasting.test.ts
  - packages/contexts/forecasting/src/domain/forecast-run.test.ts
  - packages/contexts/forecasting/src/infrastructure/ml-service-client.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["degradation","retries"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la corrida \"R3\" se solicita el 2026-12-01 y el servicio no responde en ninguno de los 5 intentos"
expected_result:
  - "\"R3\" termina fallida con el motivo servicio no disponible"
  - "la consulta muestra el pronóstico de \"R2\" con su instante de generación y la marca de que no pudo actualizarse"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-029 — Con el servicio caído en los 5 intentos la corrida falla y se muestra la vigente marcada

## Intención

Verifica el scenario "Servicio caído durante toda la ventana" del requirement "Reintentos y falla de una corrida" de `forecast/expense-forecasting` (FR-FORECAST-006, NFR-REL-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando la corrida "R3" se solicita el 2026-12-01 y el servicio no responde en ninguno de los 5 intentos
Entonces "R3" termina fallida con el motivo servicio no disponible
  Y la consulta muestra el pronóstico de "R2" con su instante de generación y la marca de que no pudo actualizarse
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
