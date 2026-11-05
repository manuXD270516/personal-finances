---
id: TC-REPORTING-REPORTS-023
title: "Cada exportación de un reporte queda auditada con actor, filtros y filas, sin contenido"
spec: reporting/financial-reports
related_specs: ["audit/audit-trail"]
requirement: "Exportaciones de reportes auditadas"
scenario: "Exportación registrada"
requirement_status: confirmed
fr: ["FR-REPORTING-012", "FR-AUDIT-013"]
nfr: []
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/financial-reports.exports.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["csv", "audit"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Reporte de gastos por categoría de 2026-10 con 12 filas"
input: {}
steps:
  - "Exportar como VIEWER"
  - "Leer el log de auditoría del workspace"
expected_result:
  - "Entrada reporting.report.exported con actor, reporte, rango 2026-10 y 12 filas"
  - "Sin montos ni descripciones en la entrada"
  - "Registrada en la misma unidad de trabajo"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-023 — Cada exportación de un reporte queda auditada con actor, filtros y filas, sin contenido

## Intención

docs/14 §12: exportar datos financieros es una acción sensible (pregunta 5 del design).

## Escenario

```gherkin
Dado un reporte de 12 filas
Cuando un VIEWER lo exporta
Entonces la auditoría registra la exportación sin el contenido
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
