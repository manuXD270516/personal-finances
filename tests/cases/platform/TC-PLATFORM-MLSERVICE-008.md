---
id: TC-PLATFORM-MLSERVICE-008
title: "La trazabilidad enlaza un TC citado por un test de Python"
spec: quality/test-traceability
related_specs: []
requirement: "Tests del servicio de pronósticos en la trazabilidad"
scenario: "Test de Python que cita un TC"
requirement_status: confirmed
fr: []
nfr: ["NFR-MAINT-004","NFR-MAINT-005"]
invariants: []
priority: high
type: unit
level: unit
automation_status: automated
automated_tests:
  - scripts/traceability/test/python-tests.test.ts
status: automated
regression_suite: false
phase: 8
tags: ["traceability","python"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un test del servicio de pronósticos tiene en su docstring \"[TC-FORECAST-SERVICE-011]\" y ese TC está marcado como automatizado con la ruta del archivo"
expected_result:
  - "la verificación de trazabilidad enlaza el TC con ese test sin errores"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-008 — La trazabilidad enlaza un TC citado por un test de Python

## Intención

Verifica el scenario "Test de Python que cita un TC" del requirement "Tests del servicio de pronósticos en la trazabilidad" de `quality/test-traceability` (NFR-MAINT-004, NFR-MAINT-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un test del servicio de pronósticos tiene en su docstring "[TC-FORECAST-SERVICE-011]" y ese TC está marcado como automatizado con la ruta del archivo
Entonces la verificación de trazabilidad enlaza el TC con ese test sin errores
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
