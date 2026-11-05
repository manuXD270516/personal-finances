---
id: TC-REPORTING-REPORTS-022
title: "El CSV del drill-down exporta todas las filas y neutraliza las fórmulas sin alterar los montos"
spec: reporting/financial-reports
related_specs: []
requirement: "Exportación CSV de un drill-down"
scenario: "Descripción con fórmula"
requirement_status: confirmed
fr: ["FR-REPORTING-012"]
nfr: ["NFR-SEC-015"]
invariants: []
priority: high
type: security
level: application
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/financial-reports.exports.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["csv", "csv-injection"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Una porción con descripción \"=HYPERLINK(1)\" y monto −200.00 BOB; la celda tiene 120 porciones"
input: {}
steps:
  - "Exportar el drill-down completo"
expected_result:
  - "El CSV tiene 120 filas de datos (no solo la página visible)"
  - "La descripción aparece como texto neutralizado"
  - "El monto aparece como \"-200.00\""
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-022 — El CSV del drill-down exporta todas las filas y neutraliza las fórmulas sin alterar los montos

## Intención

NFR-SEC-015 / docs/12 §11: inyección de fórmulas en CSV.

## Escenario

```gherkin
Dado una porción con descripción "=HYPERLINK(1)"
Cuando se exporta el drill-down
Entonces la descripción es texto y el monto es "-200.00"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
