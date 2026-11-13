---
id: TC-PLATFORM-MLSERVICE-007
title: "El despliegue sin el servicio de pronósticos deja todo healthy"
spec: platform/delivery-pipeline
related_specs: []
requirement: "Despliegue opcional del servicio de pronósticos en el host"
scenario: "Host sin el servicio de pronósticos"
requirement_status: confirmed
fr: ["FR-FORECAST-006"]
nfr: ["NFR-PORT-006","NFR-REL-010"]
invariants: []
priority: medium
type: platform
level: smoke
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 8
tags: ["deploy","N1"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "se despliega una versión en el host con el servicio de pronósticos deshabilitado"
expected_result:
  - "el despliegue termina con todos los demás servicios healthy y la función de pronóstico informa que no está habilitada"
created: 2026-11-12
updated: 2026-11-13
---

# TC-PLATFORM-MLSERVICE-007 — El despliegue sin el servicio de pronósticos deja todo healthy

## Intención

Verifica el scenario "Host sin el servicio de pronósticos" del requirement "Despliegue opcional del servicio de pronósticos en el host" de `platform/delivery-pipeline` (NFR-PORT-006, NFR-REL-010, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando se despliega una versión en el host con el servicio de pronósticos deshabilitado
Entonces el despliegue termina con todos los demás servicios healthy y la función de pronóstico informa que no está habilitada
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- Depende del despliegue real en N1 (host sin el perfil `ml`: todo healthy y `FORECASTING_ENABLED` apagado). Lo cubre en parte el E2E `tests/e2e/specs/forecast-degradation.spec.ts` (con `ml` detenido los demás servicios siguen healthy); queda `ready` hasta observarlo en el host (2026-11-13).
