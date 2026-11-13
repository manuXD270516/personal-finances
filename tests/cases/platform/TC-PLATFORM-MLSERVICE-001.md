---
id: TC-PLATFORM-MLSERVICE-001
title: "El perfil core arranca healthy sin el servicio de pronósticos"
spec: platform/local-environment
related_specs: []
requirement: "Servicio de pronósticos en el perfil ml"
scenario: "Stack sin el perfil ml"
requirement_status: confirmed
fr: ["FR-FORECAST-006"]
nfr: ["NFR-PORT-001","NFR-REL-010"]
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 8
tags: ["compose","ml"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el desarrollador levanta solo el perfil `core`"
expected_result:
  - "todos los servicios de `core` quedan healthy y el servicio de pronósticos no se inicia"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-001 — El perfil core arranca healthy sin el servicio de pronósticos

## Intención

Verifica el scenario "Stack sin el perfil ml" del requirement "Servicio de pronósticos en el perfil ml" de `platform/local-environment` (NFR-PORT-001, NFR-REL-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el desarrollador levanta solo el perfil `core`
Entonces todos los servicios de `core` quedan healthy y el servicio de pronósticos no se inicia
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
