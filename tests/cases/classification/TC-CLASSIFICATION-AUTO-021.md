---
id: TC-CLASSIFICATION-AUTO-021
title: "La sugerencia funciona con el servicio de pronósticos detenido"
spec: classification/auto-classification
related_specs: []
requirement: "Sugerencias sin el servicio de pronósticos ni procesos nuevos"
scenario: "Servicio de pronósticos apagado"
requirement_status: confirmed
fr: ["FR-CLASSIFICATION-014","FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: medium
type: integration
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/category-suggestions.api.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["category-suggestions"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios; historial clasificado por el usuario (origen manual) salvo que el escenario diga otro"
input: {}
steps:
  - "el servicio de pronósticos está detenido y FORECASTING_ENABLED=false"
  - "el EDITOR pide la sugerencia para \"PEDIDOSYA\""
expected_result:
  - "la respuesta es SUGGESTED como con el servicio encendido"
  - "el worker no tiene trabajos ni consumidores nuevos"
created: 2026-11-25
updated: 2026-11-25
---

# TC-CLASSIFICATION-AUTO-021 — La sugerencia funciona con el servicio de pronósticos detenido

## Intención

Verifica el scenario "Servicio de pronósticos apagado" del requirement "Sugerencias sin el servicio de pronósticos ni procesos nuevos" de `classification/auto-classification` (FR-CLASSIFICATION-014, FR-FORECAST-006).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y las sugerencias de categoría habilitadas
Cuando el servicio de pronósticos está detenido y FORECASTING_ENABLED=false
Y el EDITOR pide la sugerencia para "PEDIDOSYA"
Entonces la respuesta es SUGGESTED como con el servicio encendido
Y el worker no tiene trabajos ni consumidores nuevos
```

## Notas

- Change `add-category-suggestions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
