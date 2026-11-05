---
id: TC-REPORTING-REPORTS-029
title: "El nightly verifica la reconciliación de los reportes sobre los 60 meses del Large Seed"
spec: reporting/financial-reports
related_specs: []
requirement: "Reconciliación de los reportes con el ledger"
scenario: null
requirement_status: confirmed
fr: ["FR-REPORTING-008"]
nfr: ["NFR-DATA-008", "NFR-PERF-006"]
invariants: []
priority: critical
type: platform
level: performance
automation_status: automated
automated_tests:
  - apps/api/test/perf/nightly.perf.ts
  - packages/contexts/reporting/src/application/reports-reconciliation.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["reconciliation", "nightly", "large-seed", "exit-criteria"]
error_code: null
preconditions:
  - "Large Seed v2 cargado por el nightly"
input: {}
steps:
  - "Verificar ingresos y gastos por mes y moneda de los 60 meses contra el balance de comprobación"
  - "Verificar 50 celdas de drill-down al azar y el flujo de caja de los 12 meses medidos"
expected_result:
  - "0 diferencias"
  - "Un fallo bloquea el nightly e indica reporte, periodo y moneda"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-029 — El nightly verifica la reconciliación de los reportes sobre los 60 meses del Large Seed

## Intención

Evidencia del criterio de salida con el volumen real de diseño.

## Escenario

```gherkin
Dado el Large Seed
Cuando el nightly reconcilia los reportes
Entonces no hay diferencias en los 60 meses
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
