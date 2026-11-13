---
id: TC-PLATFORM-MLSERVICE-004
title: "Una propiedad de intervalos rota hace fallar los tests del servicio"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Gate del servicio de pronósticos en el pull request"
scenario: "Propiedad de intervalos rota"
requirement_status: provisional
fr: ["FR-FORECAST-006"]
nfr: ["NFR-MAINT-001","NFR-SEC-013"]
invariants: []
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["ci","hypothesis"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un cambio en el servicio produce un límite inferior mayor que el valor esperado para alguna serie de los ejemplos"
expected_result:
  - "fallan los tests del servicio"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-004 — Una propiedad de intervalos rota hace fallar los tests del servicio

## Intención

Verifica el scenario "Propiedad de intervalos rota" del requirement "Gate del servicio de pronósticos en el pull request" de `platform/delivery-pipeline` (NFR-MAINT-001, NFR-SEC-013, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un cambio en el servicio produce un límite inferior mayor que el valor esperado para alguna serie de los ejemplos
Entonces fallan los tests del servicio
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
