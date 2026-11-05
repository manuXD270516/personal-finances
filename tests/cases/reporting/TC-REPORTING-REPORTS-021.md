---
id: TC-REPORTING-REPORTS-021
title: "El CSV de ingresos y gastos trae filas nativas y consolidadas, y una exportación de más de 50 000 filas se rechaza"
spec: reporting/financial-reports
related_specs: []
requirement: "Exportación CSV de un reporte"
scenario: "Exportar ingresos y gastos de octubre"
requirement_status: provisional
fr: ["FR-REPORTING-012"]
nfr: ["NFR-SEC-015"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["csv"]
error_code: "REPORT_EXPORT_TOO_LARGE"
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Datos de 2026-10 de TC-REPORTING-REPORTS-005"
  - "Caso aparte: exportación que tendría 50 001 filas"
input: {}
steps:
  - "GET W/reports/income-expenses/export de 2026-10 como VIEWER"
  - "Pedir la exportación de 50 001 filas"
expected_result:
  - "UTF-8 con BOM, coma y punto decimal, encabezado estable"
  - "Fila BOB NATIVE ingreso \"12000.00\" gasto \"3300.00\"; fila USD NATIVE gasto \"50.00\"; fila CONSOLIDATED BOB ingreso \"12000.00\" gasto \"3800.00\" ahorro \"8200.00\" tasa \"68.3\" completo"
  - "La de 50 001 filas ⇒ 422 REPORT_EXPORT_TOO_LARGE sin archivo"
  - "Cuota costly aplicada"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-021 — El CSV de ingresos y gastos trae filas nativas y consolidadas, y una exportación de más de 50 000 filas se rechaza

## Intención

FR-REPORTING-012: exportar sin perder la moneda ni la política de conversión.

## Escenario

```gherkin
Dado el reporte de 2026-10
Cuando un VIEWER lo exporta
Entonces obtiene filas nativas por moneda y una consolidada en BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
