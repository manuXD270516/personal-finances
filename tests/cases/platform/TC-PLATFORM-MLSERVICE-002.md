---
id: TC-PLATFORM-MLSERVICE-002
title: "Con el perfil ml el servicio queda healthy sin credenciales de datos"
spec: platform/local-environment
related_specs: []
requirement: "Servicio de pronósticos en el perfil ml"
scenario: "Stack con el perfil ml"
requirement_status: confirmed
fr: ["FR-FORECAST-006"]
nfr: ["NFR-PORT-001","NFR-REL-010"]
invariants: []
priority: high
type: platform
level: smoke
automation_status: automated
automated_tests:
  - services/ml-forecasting/tests/test_api.py
status: automated
regression_suite: false
phase: 8
tags: ["compose","ml"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el desarrollador levanta `core` junto con `ml`"
expected_result:
  - "el servicio de pronósticos queda healthy y el worker lo alcanza por la red interna"
  - "el servicio no tiene variables de conexión a la base de datos ni al almacenamiento de objetos"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-002 — Con el perfil ml el servicio queda healthy sin credenciales de datos

## Intención

Verifica el scenario "Stack con el perfil ml" del requirement "Servicio de pronósticos en el perfil ml" de `platform/local-environment` (NFR-PORT-001, NFR-REL-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el desarrollador levanta `core` junto con `ml`
Entonces el servicio de pronósticos queda healthy y el worker lo alcanza por la red interna
  Y el servicio no tiene variables de conexión a la base de datos ni al almacenamiento de objetos
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
