---
id: TC-REPORTING-REPORTS-052
title: "Los reportes ampliados cuadran con el ledger: cuentas, comisiones, deudas, metas y drill-down"
spec: reporting/financial-reports
related_specs: ["ledger/balances"]
requirement: "Reconciliación de los reportes ampliados con el ledger"
scenario: "Gasto por cuenta igual al total"
requirement_status: provisional
fr: ["FR-REPORTING-008", "FR-REPORTING-010"]
nfr: ["NFR-DATA-008"]
invariants: ["INV-018", "INV-021", "INV-022"]
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["reconciliation", "pbt"]
error_code: null
preconditions:
  - "Generador de ledgers del núcleo ampliado con metas, préstamos y etiquetas"
  - "Dataset Demo v2"
input: {}
steps:
  - "Aplicar las identidades ampliadas de ReportReconciler"
  - "Repetir sobre el dataset Demo v2"
expected_result:
  - "Σ cuentas = gasto; Σ comisiones ≤ gasto"
  - "Pendiente de cada deuda = saldo contable a cada cierre"
  - "Acumulado de cada meta = Σ movimientos"
  - "Σ drill-down = celda"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-052 — Los reportes ampliados cuadran con el ledger: cuentas, comisiones, deudas, metas y drill-down

## Intención

Extiende el criterio de salida a los reportes ampliados.

## Escenario

```gherkin
Dado un gasto en BOB de 3800.00 en 2026-10 según el ledger
Cuando se calcula gastos por cuenta
Entonces las cuentas suman 3800.00 BOB
```

## Notas

- PBT con timeout explícito (CI es más lento).
- Change `add-financial-reports-extended` (Phase 7).
