---
id: TC-REPORTING-FORECAST-017
title: "La tarjeta Q8 muestra el riesgo más alto con su mínimo o el mínimo consolidado y nada sin cuentas líquidas"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Saldo esperado y riesgo en la tarjeta de Q8"
scenario: "Riesgo alto en el Home"
requirement_status: provisional
fr: ["FR-REPORTING-014","FR-REPORTING-015","FR-REPORTING-001"]
nfr: ["NFR-PERF-004"]
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","home","q8"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
input: {"endpoint":"GET W/reports/summary"}
steps:
  - "Abrir el Home con riesgo HIGH en BOB (mínimo −679.00 BOB el 2026-11-01) y NONE en USD"
  - "Abrir el Home sin riesgo (mínimo consolidado 4949.12 BOB el 2026-10-28)"
  - "Abrir el Home de un workspace solo con una tarjeta"
expected_result:
  - "Q8: riesgo alto en BOB, −679.00 BOB, 2026-11-01, enlace al calendario"
  - "Q8: 4949.12 BOB el 2026-10-28"
  - "Sin cuentas líquidas: cashFlow null; Q8 lista pagos sin saldo esperado"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-017 — La tarjeta Q8 muestra el riesgo más alto con su mínimo o el mínimo consolidado y nada sin cuentas líquidas

## Intención

Q8 completo ("con saldo esperado", docs/00 §6) para SM-05.

## Escenario

```gherkin
Dado FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)
Cuando Abrir el Home con riesgo HIGH en BOB (mínimo −679.00 BOB el 2026-11-01) y NONE en USD
Entonces Q8: riesgo alto en BOB, −679.00 BOB, 2026-11-01, enlace al calendario
  Y Q8: 4949.12 BOB el 2026-10-28
  Y Sin cuentas líquidas: cashFlow null; Q8 lista pagos sin saldo esperado
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Saldo esperado y riesgo en la tarjeta de Q8" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
