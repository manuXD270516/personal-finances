---
id: TC-REPORTING-REPORTS-050
title: "Las vistas guardadas son personales: otro miembro no las ve y un filtro archivado se avisa"
spec: reporting/financial-reports
related_specs: ["security/access-control"]
requirement: "Vistas guardadas personales y aisladas"
scenario: "Vista de otro miembro"
requirement_status: confirmed
fr: ["FR-REPORTING-019"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: high
type: security
level: security
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/saved-report-views.test.ts
  - apps/api/test/api/financial-reports-extended.api.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["saved-views", "rls"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Vista \"Gastos del viaje\" del owner"
  - "Un EDITOR del mismo workspace y un usuario de otro workspace"
input: {}
steps:
  - "El EDITOR lista y pide la vista del owner"
  - "El usuario de otro workspace la pide"
  - "Archivar \"Viaje Cusco\" y abrir la vista como owner"
expected_result:
  - "El EDITOR no la ve y su petición se responde como inexistente"
  - "El usuario de otro workspace no la ve"
  - "El owner ve el reporte con el aviso de etiqueta archivada"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-050 — Las vistas guardadas son personales: otro miembro no las ve y un filtro archivado se avisa

## Intención

RLS fail-closed por workspace y usuario sobre una tabla nueva.

## Escenario

```gherkin
Dado la vista del owner
Cuando un EDITOR intenta abrirla
Entonces la petición se rechaza como inexistente
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
