---
id: TC-PLATFORM-MLSERVICE-006
title: "El servicio desplegado ejecuta el digest de la corrida exitosa de la rama principal"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Imagen del servicio de pronósticos promovida por digest"
scenario: "Despliegue por digest"
requirement_status: confirmed
fr: []
nfr: ["NFR-PORT-006","NFR-SEC-013","NFR-SEC-014"]
invariants: []
priority: high
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 8
tags: ["deploy"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se despliega una versión con el perfil `ml` habilitado en el host"
expected_result:
  - "el servicio de pronósticos ejecuta la imagen con el digest que produjo la corrida exitosa de la rama principal"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-006 — El servicio desplegado ejecuta el digest de la corrida exitosa de la rama principal

## Intención

Verifica el scenario "Despliegue por digest" del requirement "Imagen del servicio de pronósticos promovida por digest" de `platform/delivery-pipeline` (NFR-PORT-006, NFR-SEC-013, NFR-SEC-014).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se despliega una versión con el perfil `ml` habilitado en el host
Entonces el servicio de pronósticos ejecuta la imagen con el digest que produjo la corrida exitosa de la rama principal
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
