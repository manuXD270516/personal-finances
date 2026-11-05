---
id: TC-REPORTING-REPORTS-044
title: "La evolución de deudas informa el saldo pendiente del ledger y el principal e interés pagados por mes"
spec: reporting/financial-reports
related_specs: ["debt/loans", "debt/amortization"]
requirement: "Reporte de evolución de deudas"
scenario: "Crédito auto en dos meses"
requirement_status: provisional
fr: ["FR-REPORTING-008", "FR-DEBT-013"]
nfr: []
invariants: ["INV-016", "INV-022"]
priority: medium
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["debts"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "\"Crédito auto\" 20000.00 BOB pendientes al 2026-08-31"
  - "Sep: principal 1100.00, interés 320.00; Oct: principal 1110.00, interés 310.00 BOB"
input: {}
steps:
  - "Calcular la evolución de 2026-09 a 2026-10"
expected_result:
  - "Pendiente 18900.00 BOB (sep) y 17790.00 BOB (oct), igual al saldo contable"
  - "Interés pagado 320.00 y 310.00 BOB"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-044 — La evolución de deudas informa el saldo pendiente del ledger y el principal e interés pagados por mes

## Intención

Reporte 10: "¿cómo baja mi deuda y cuánto pago de interés?"

## Escenario

```gherkin
Dado "Crédito auto" con 20000.00 BOB pendientes
Cuando se pagan dos cuotas
Entonces el pendiente es 18900.00 y 17790.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports-extended` (Phase 7); depende de `add-financial-reports`.
