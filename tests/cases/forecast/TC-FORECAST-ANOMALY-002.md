---
id: TC-FORECAST-ANOMALY-002
title: "Un gasto de 2,5 veces la mediana no se marca aunque su puntaje robusto supere 3,5"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su categoría"
scenario: "Alto pero no tanto"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["anomalies"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada"
  - "FixedClock en la fecha del escenario (TZ America/La_Paz); datos ficticios"
input: {}
steps:
  - "la historia de \"Restaurantes\" es la de TC-FORECAST-ANOMALY-001"
  - "se registra un gasto de 200.00 BOB en \"Restaurantes\""
expected_result:
  - "el gasto no se marca: razón 2.5, menor que 3.0"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-002 — Un gasto de 2,5 veces la mediana no se marca aunque su puntaje robusto supere 3,5

## Intención

Verifica el scenario "Alto pero no tanto" del requirement "Gastos atípicos para su categoría" de `forecast/anomaly-detection` (FR-FORECAST-010).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando la historia de "Restaurantes" es la de TC-FORECAST-ANOMALY-001
Y se registra un gasto de 200.00 BOB en "Restaurantes"
Entonces el gasto no se marca: razón 2.5, menor que 3.0
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
