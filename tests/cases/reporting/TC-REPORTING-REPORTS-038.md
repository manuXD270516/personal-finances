---
id: TC-REPORTING-REPORTS-038
title: "La comparación del Home enlaza al reporte de ingresos y gastos con las mismas cifras"
spec: reporting/dashboard
related_specs: ["reporting/financial-reports"]
requirement: "Detalle de la comparación del Home en los reportes"
scenario: "Del Home al reporte"
requirement_status: provisional
fr: ["FR-REPORTING-018", "FR-REPORTING-009"]
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["home", "q7"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "Hoy 2026-10-15; gasto del 1 al 15 de octubre 1800.00 BOB y del 1 al 15 de septiembre 1500.00 BOB"
input: {}
steps:
  - "Abrir el Home y tocar el enlace de Q7"
expected_result:
  - "Se abre el reporte de ingresos y gastos de 2026-10 por mes calendario comparado a la fecha"
  - "Gasto 1800.00 BOB y variación 20.00 %, igual que el Home"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-038 — La comparación del Home enlaza al reporte de ingresos y gastos con las mismas cifras

## Intención

SM-05 / Q7: el Home y los reportes cuentan la misma historia.

## Escenario

```gherkin
Dado el Home con un gasto de 1800.00 BOB y +20.00 %
Cuando el owner toca el enlace de Q7
Entonces el reporte informa el mismo gasto y la misma variación
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
