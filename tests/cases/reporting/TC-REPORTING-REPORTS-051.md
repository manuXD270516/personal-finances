---
id: TC-REPORTING-REPORTS-051
title: "El PDF de un reporte incluye la tabla, la política de conversión y las tasas usadas"
spec: reporting/financial-reports
related_specs: []
requirement: "Exportación PDF de un reporte"
scenario: "PDF de ingresos y gastos"
requirement_status: confirmed
fr: ["FR-REPORTING-013"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 7
tags: ["pdf"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Datos de 2026-10 de TC-REPORTING-REPORTS-005"
input: {}
steps:
  - "GET W/reports/income-expenses/export.pdf de 2026-10 como VIEWER"
expected_result:
  - "application/pdf con ingreso 12000.00, gasto 3800.00 y ahorro 8200.00 BOB"
  - "Incluye la política de tasa de la fecha de cada movimiento y la tasa USD/BOB 10.00"
  - "No se almacena el archivo; cuota costly"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-051 — El PDF de un reporte incluye la tabla, la política de conversión y las tasas usadas

## Intención

FR-REPORTING-013 (Could).

## Escenario

```gherkin
Dado el reporte de 2026-10
Cuando un VIEWER lo exporta como PDF
Entonces el PDF muestra las cifras y la política de conversión
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.

- **Diferido (Could):** el PDF no se implementó en este change (decisión del owner: solo si sobra tiempo); la tarea 3.5 quedó marcada como diferida. El caso queda `ready` y sin automatizar.
