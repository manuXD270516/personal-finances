---
id: TC-REPORTING-REPORTS-001
title: "El catálogo lista los 16 reportes con su estado y el pronóstico vs real queda planificado sin cifras"
spec: reporting/financial-reports
related_specs: []
requirement: "Catálogo de reportes con su disponibilidad"
scenario: "Catálogo al terminar este change"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-REPORTING-001"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/financial-reports.api.test.ts
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: false
phase: 7
tags: ["catalog"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
input: {}
steps:
  - "GET W/reports/catalog como VIEWER"
expected_result:
  - "16 entradas numeradas del 1 al 16"
  - "Los reportes 1, 2, 3, 7, 8 y 15 con estado AVAILABLE"
  - "El reporte 16 con estado PLANNED y fase 8, sin cifras"
  - "El reporte 13 con estado PARTIAL y el enlace a la vista de costo de conversiones"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-001 — El catálogo lista los 16 reportes con su estado y el pronóstico vs real queda planificado sin cifras

## Intención

FR-REPORTING-001/008: el catálogo nunca muestra cifras inventadas para reportes que aún no existen.

## Escenario

```gherkin
Dado un workspace con datos
Cuando un miembro consulta el catálogo de reportes
Entonces recibe 16 reportes con su estado
  Y "Pronóstico vs real" figura planificado para Phase 8 sin cifras
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
