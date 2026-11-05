---
id: TC-REPORTING-REPORTS-048
title: "Con los reportes ampliados el catálogo informa 15 disponibles y el pronóstico vs real planificado"
spec: reporting/financial-reports
related_specs: []
requirement: "Reportes ampliados en el catálogo"
scenario: "Catálogo completo de Phase 7"
requirement_status: provisional
fr: ["FR-REPORTING-008", "FR-REPORTING-001"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["catalog"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
input: {}
steps:
  - "GET W/reports/catalog"
expected_result:
  - "15 reportes AVAILABLE"
  - "\"Pronóstico vs real\" PLANNED para Phase 8"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-048 — Con los reportes ampliados el catálogo informa 15 disponibles y el pronóstico vs real planificado

## Intención

Catálogo completo de Phase 7 (docs/24 §5.7).

## Escenario

```gherkin
Dado los reportes ampliados desplegados
Cuando se consulta el catálogo
Entonces 15 reportes están disponibles y el 16 planificado
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
