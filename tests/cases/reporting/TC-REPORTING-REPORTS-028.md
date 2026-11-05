---
id: TC-REPORTING-REPORTS-028
title: "Los reportes del dataset Demo v2 cuadran con el balance de comprobación del ledger"
spec: reporting/financial-reports
related_specs: ["ledger/balances"]
requirement: "Reconciliación de los reportes con el ledger"
scenario: "Octubre cuadra con el ledger"
requirement_status: confirmed
fr: ["FR-REPORTING-008"]
nfr: ["NFR-DATA-008"]
invariants: ["INV-021", "INV-024"]
priority: critical
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/demo/demo-v2.int.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["reconciliation", "exit-criteria"]
error_code: null
preconditions:
  - "Dataset Demo v2 cargado en PostgreSQL"
input: {}
steps:
  - "Para cada mes y moneda, comparar los reportes con la diferencia del balance de comprobación entre cierres de mes"
expected_result:
  - "Ingreso y gasto nativos idénticos a INCOME/EXPENSE del ledger"
  - "Σ categorías = gasto; flujo de caja e historial de saldo cuadran con los saldos contables"
  - "Diferencia tolerada: 0"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-028 — Los reportes del dataset Demo v2 cuadran con el balance de comprobación del ledger

## Intención

La reconciliación se verifica por un camino independiente (balance de comprobación del ledger frente a porciones de Transactions).

## Escenario

```gherkin
Dado el dataset Demo v2
Cuando se comparan los reportes con el ledger mes a mes
Entonces no hay ninguna diferencia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
