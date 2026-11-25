---
id: TC-FORECAST-ANOMALY-014
title: "El motivo se arma por plantilla con la razón, la mediana y la historia"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Motivo explicable de cada gasto atípico"
scenario: "Texto del motivo"
requirement_status: provisional
fr: ["FR-FORECAST-010","FR-FORECAST-004"]
nfr: ["NFR-USAB-002"]
invariants: []
priority: medium
type: unit
level: unit
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
  - "un gasto de 304.00 BOB en \"Restaurantes\" es atípico frente a una mediana de 80.00 BOB sobre 12 gastos"
  - "se arma el texto del motivo con locale es-BO"
expected_result:
  - "el texto dice que el gasto es 3,8 veces la mediana de \"Restaurantes\" (80,00 BOB en los últimos 12 meses, 12 gastos)"
  - "el texto no contiene las palabras error ni fraude"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-014 — El motivo se arma por plantilla con la razón, la mediana y la historia

## Intención

Verifica el scenario "Texto del motivo" del requirement "Motivo explicable de cada gasto atípico" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-004).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB, TZ America/La_Paz y la detección de gastos atípicos habilitada
Cuando un gasto de 304.00 BOB en "Restaurantes" es atípico frente a una mediana de 80.00 BOB sobre 12 gastos
Y se arma el texto del motivo con locale es-BO
Entonces el texto dice que el gasto es 3,8 veces la mediana de "Restaurantes" (80,00 BOB en los últimos 12 meses, 12 gastos)
Y el texto no contiene las palabras error ni fraude
```

## Notas

- Change `add-spending-anomaly-detection` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
