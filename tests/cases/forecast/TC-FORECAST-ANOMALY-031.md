---
id: TC-FORECAST-ANOMALY-031
title: "La fila del nightly falla con precisión 0.7692 y recall 0.8000 e informa los marcados sin etiqueta por criterio"
spec: forecast/anomaly-detection
related_specs: []
requirement: "Evaluación contra las anomalías etiquetadas del Large Seed"
scenario: "Umbrales no cumplidos"
requirement_status: provisional
fr: ["FR-FORECAST-010", "FR-FORECAST-007"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["anomalies", "calibration", "nightly"]
error_code: null
preconditions:
  - "Evaluación con 140 marcados: 100 con OUTLIER o NEW_COUNTERPARTY_FRAUD, 10 con otra etiqueta y 30 sin etiqueta; 125 gastos con esas dos etiquetas"
input: {}
steps:
  - "se construye el informe de la evaluación con los umbrales 0.80 y 0.85"
expected_result:
  - "precisión 0.7692 y recall 0.8000"
  - "el resultado es FAIL"
  - "el informe reparte los 30 marcados sin etiqueta por criterio y muestra los umbrales, sin montos ni descripciones"
created: 2026-11-25
updated: 2026-11-25
---

# TC-FORECAST-ANOMALY-031 — La fila del nightly falla con precisión 0.7692 y recall 0.8000 e informa los marcados sin etiqueta por criterio

## Intención

Verifica el scenario "Umbrales no cumplidos" del requirement "Evaluación contra las anomalías etiquetadas del Large Seed" de `forecast/anomaly-detection` (FR-FORECAST-010, FR-FORECAST-007).

## Escenario

```gherkin
Dado Evaluación con 140 marcados: 100 con OUTLIER o NEW_COUNTERPARTY_FRAUD, 10 con otra etiqueta y 30 sin etiqueta; 125 gastos con esas dos etiquetas
Cuando se construye el informe de la evaluación con los umbrales 0.80 y 0.85
Entonces precisión 0.7692 y recall 0.8000
Y el resultado es FAIL
Y el informe reparte los 30 marcados sin etiqueta por criterio y muestra los umbrales, sin montos ni descripciones
```

## Notas

- Change `refine-spending-anomaly-calibration` (Phase 9); umbrales de la pregunta 2 de docs/80 (recomendación). Datos ficticios.
