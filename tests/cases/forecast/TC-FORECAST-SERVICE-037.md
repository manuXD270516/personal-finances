---
id: TC-FORECAST-SERVICE-037
title: "Tres corridas fallidas seguidas suman la métrica y disparan la alerta"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Métricas de las corridas"
scenario: "Tres corridas fallidas seguidas"
requirement_status: provisional
fr: []
nfr: ["NFR-OBS-009","NFR-OBS-004"]
invariants: []
priority: medium
type: platform
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["observability"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "las corridas de tres días seguidos terminan fallidas por servicio no disponible"
expected_result:
  - "la métrica de fallas suma 3 con el motivo sin respuesta y se dispara la alerta de pronósticos fallidos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-FORECAST-SERVICE-037 — Tres corridas fallidas seguidas suman la métrica y disparan la alerta

## Intención

Verifica el scenario "Tres corridas fallidas seguidas" del requirement "Métricas de las corridas" de `forecast/expense-forecasting` (NFR-OBS-009, NFR-OBS-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando las corridas de tres días seguidos terminan fallidas por servicio no disponible
Entonces la métrica de fallas suma 3 con el motivo sin respuesta y se dispara la alerta de pronósticos fallidos
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
