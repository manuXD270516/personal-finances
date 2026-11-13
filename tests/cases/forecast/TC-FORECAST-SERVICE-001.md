---
id: TC-FORECAST-SERVICE-001
title: "Con el servicio de pronósticos apagado el núcleo responde igual y se muestra el último pronóstico"
spec: forecast/expense-forecasting
related_specs: []
requirement: "Pronóstico opcional y aislado del núcleo"
scenario: "Servicio de pronósticos apagado"
requirement_status: confirmed
fr: ["FR-FORECAST-006"]
nfr: ["NFR-REL-010"]
invariants: []
priority: critical
type: e2e
level: container-integration
automation_status: automated
automated_tests:
  - tests/e2e/specs/forecast-degradation.spec.ts
  - apps/web/src/ui/forecasts/forecasts.test.tsx
status: automated
regression_suite: false
phase: 8
tags: ["degradation"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1 salvo que el escenario diga otro"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "el servicio de pronósticos está detenido y un EDITOR registra un gasto de 150.00 BOB en \"Banco BOB\" y consulta el Home"
expected_result:
  - "el gasto se registra y el Home responde con las mismas cifras que sin la función de pronóstico"
  - "la consulta del pronóstico devuelve el último pronóstico publicado con su instante de generación"
created: 2026-11-12
updated: 2026-11-13
---

# TC-FORECAST-SERVICE-001 — Con el servicio de pronósticos apagado el núcleo responde igual y se muestra el último pronóstico

## Intención

Verifica el scenario "Servicio de pronósticos apagado" del requirement "Pronóstico opcional y aislado del núcleo" de `forecast/expense-forecasting` (FR-FORECAST-006, NFR-REL-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz
Cuando el servicio de pronósticos está detenido y un EDITOR registra un gasto de 150.00 BOB en "Banco BOB" y consulta el Home
Entonces el gasto se registra y el Home responde con las mismas cifras que sin la función de pronóstico
  Y la consulta del pronóstico devuelve el último pronóstico publicado con su instante de generación
```

## Notas

- Change `add-ml-forecasting-service` (Phase 8). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
