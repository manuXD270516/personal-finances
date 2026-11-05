---
id: TC-REPORTING-REPORTS-032
title: "La duración de cada reporte se mide por reporte y la alerta recomienda un read model al acercarse al presupuesto"
spec: reporting/financial-reports
related_specs: []
requirement: "Métrica de duración y alerta de evolución a read models"
scenario: "Reporte cerca del presupuesto"
requirement_status: provisional
fr: ["FR-REPORTING-007"]
nfr: ["NFR-OBS-004"]
invariants: []
priority: medium
type: platform
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["observability"]
error_code: null
preconditions:
  - "Métrica reporting_report_duration_seconds con etiqueta report"
input: {}
steps:
  - "Pedir cada reporte y leer /metrics"
  - "Evaluar la regla de alerta con un p95 de 640 ms durante 7 días"
expected_result:
  - "Una serie por reporte, sin etiquetas de alta cardinalidad"
  - "La alerta ReportsReadModelRecommended se dispara para ese reporte"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-032 — La duración de cada reporte se mide por reporte y la alerta recomienda un read model al acercarse al presupuesto

## Intención

Decisión 2 del design: los read models se introducen cuando una métrica lo justifica.

## Escenario

```gherkin
Dado un p95 de 640 ms durante 7 días
Cuando se evalúa la alerta
Entonces recomienda un read model para ese reporte
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
