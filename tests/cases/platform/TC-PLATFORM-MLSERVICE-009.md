---
id: TC-PLATFORM-MLSERVICE-009
title: "La trazabilidad falla con un test de Python que cita un TC inexistente"
spec: quality/test-traceability
related_specs: []
requirement: "Tests del servicio de pronósticos en la trazabilidad"
scenario: "Test de Python con un TC inexistente"
requirement_status: provisional
fr: []
nfr: ["NFR-MAINT-004","NFR-MAINT-005"]
invariants: []
priority: high
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 8
tags: ["traceability","python"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "un test del servicio de pronósticos cita \"[TC-FORECAST-SERVICE-999]\", que no existe en el catálogo"
expected_result:
  - "la verificación de trazabilidad falla indicando el TC inexistente"
created: 2026-11-12
updated: 2026-11-12
---

# TC-PLATFORM-MLSERVICE-009 — La trazabilidad falla con un test de Python que cita un TC inexistente

## Intención

Verifica el scenario "Test de Python con un TC inexistente" del requirement "Tests del servicio de pronósticos en la trazabilidad" de `quality/test-traceability` (NFR-MAINT-004, NFR-MAINT-005).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando un test del servicio de pronósticos cita "[TC-FORECAST-SERVICE-999]", que no existe en el catálogo
Entonces la verificación de trazabilidad falla indicando el TC inexistente
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
