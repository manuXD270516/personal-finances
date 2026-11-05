---
id: TC-REPORTING-REPORTS-027
title: "PBT: los reportes cuadran con el ledger para ledgers aleatorios y una diferencia mínima falla nombrando reporte, periodo y moneda"
spec: reporting/financial-reports
related_specs: ["ledger/balances"]
requirement: "Reconciliación de los reportes con el ledger"
scenario: "Diferencia detectada"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-REPORTING-010"]
nfr: ["NFR-DATA-008"]
invariants: ["INV-004", "INV-021", "INV-022", "INV-031"]
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/reports-reconciliation.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["reconciliation", "pbt", "exit-criteria"]
error_code: null
preconditions:
  - "Generador de ledgers balanceados por moneda (ingresos, gastos, reembolsos, transferencias, conversiones con comisión, cuotas, pagos de tarjeta) y tasas aleatorias > 0"
input: {}
steps:
  - "Calcular cada reporte con funciones puras"
  - "Aplicar las identidades de ReportReconciler"
  - "Inyectar una diferencia de 0.01 BOB en un reporte"
expected_result:
  - "Ingreso y gasto nativos = movimientos de INCOME/EXPENSE por moneda y periodo"
  - "Σ categorías = gasto; inicial + componentes = final; ΔNW = Σ componentes; Σ drill-down = celda"
  - "La diferencia inyectada falla indicando reporte, periodo y moneda"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-027 — PBT: los reportes cuadran con el ledger para ledgers aleatorios y una diferencia mínima falla nombrando reporte, periodo y moneda

## Intención

Criterio de salida de Phase 7 (docs/24 §5.7): reportes cuadran contra el ledger.

## Escenario

```gherkin
Dado un ledger aleatorio balanceado por moneda
Cuando un reporte informara 3300.01 BOB frente a 3300.00 del ledger
Entonces la verificación falla indicando el reporte, el periodo y la moneda
```

## Notas

- PBT con timeout explícito (CI es más lento).
- Change `add-financial-reports` (Phase 7).
