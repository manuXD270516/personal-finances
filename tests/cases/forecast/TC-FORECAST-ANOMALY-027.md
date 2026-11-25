---
id: TC-FORECAST-ANOMALY-027
title: "Un gasto de 4.5 veces la mediana en una categoría dispersa no se marca con puntaje robusto menor que 15"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Gastos atípicos para su categoría"
scenario: "Gasto alto en una categoría dispersa"
requirement_status: provisional
fr: ["FR-FORECAST-010"]
nfr: ["NFR-DATA-001"]
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["anomalies", "calibration"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB, TZ America/La_Paz y parámetros por omisión (15, 3, 8, 99.5)"
  - "\"Regalos y celebraciones\" con 20 gastos en los 365 días anteriores, mediana 100.00 BOB y MAD 40.00 BOB"
input: {}
steps:
  - "se evalúa un gasto de 450.00 BOB en \"Regalos y celebraciones\""
expected_result:
  - "el gasto no se marca"
  - "la razón es 4.5 y el puntaje robusto 5.90, menor que 15"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-027 — Un gasto de 4.5 veces la mediana en una categoría dispersa no se marca con puntaje robusto menor que 15

## Intención

Verifica el scenario "Gasto alto en una categoría dispersa" del requirement "Gastos atípicos para su categoría" de `forecast/anomaly-detection` (FR-FORECAST-010, NFR-DATA-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y parámetros por omisión (15, 3, 8, 99.5)
Y "Regalos y celebraciones" con 20 gastos en los 365 días anteriores, mediana 100.00 BOB y MAD 40.00 BOB
Cuando se evalúa un gasto de 450.00 BOB en "Regalos y celebraciones"
Entonces el gasto no se marca
Y la razón es 4.5 y el puntaje robusto 5.90, menor que 15
```

## Notas

- Change `refine-spending-anomaly-calibration` (Phase 9), D488; parámetros de la pregunta 1 de docs/80 (recomendación). Datos ficticios; Decimal y HALF_EVEN; ningún dato real del owner.
