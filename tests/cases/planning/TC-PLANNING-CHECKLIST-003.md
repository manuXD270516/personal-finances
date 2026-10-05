---
id: TC-PLANNING-CHECKLIST-003
title: Una cuenta cuenta como conciliada solo con conciliación a diferencia cero hasta el fin del periodo
spec: planning/month-closing
related_specs:
  - transactions/reconciliation
requirement: Cuentas conciliadas a diferencia cero
scenario: Cuentas conciliadas, pendientes y exentas
requirement_status: provisional
fr:
  - FR-PLANNING-003
  - FR-TRANSACTIONS-030
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - reconciliation
  - cross-change:pf-p2c
error_code: null
preconditions:
  - '"Bank A": conciliación finalizada al 2026-10-31, extracto 5200.00 BOB, diferencia 0.00 BOB'
  - '"USD Savings": última conciliación al 2026-09-30'
  - '"Caja chica": saldo 0.00 BOB sin movimientos en octubre'
input:
  - period: 2026-10
  - afterReconciling:
      account: Bank A
      expense: "50.00"
      currency: BOB
      date: 2026-10-15
      status: posted
steps:
  - Consultar el checklist de "2026-10"
  - Registrar el gasto retroactivo en "Bank A"
  - Consultar el checklist de nuevo
expected_result:
  - '"Bank A" conciliada, "USD Savings" sin conciliar, "Caja chica" no exigida'
  - Tras el gasto retroactivo, "Bank A" vuelve a aparecer sin conciliar
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-CHECKLIST-003 — Una cuenta cuenta como conciliada solo con conciliación a diferencia cero hasta el fin del periodo

## Intención

El criterio de salida de Phase 2 exige todas las cuentas conciliadas a diferencia 0; un gasto retroactivo invalida la conciliación.

## Escenario

```gherkin
Dado que "Bank A" está conciliada al 2026-10-31 con diferencia 0.00 BOB
Cuando se registra un gasto posteado de 50.00 BOB con fecha 2026-10-15
Entonces "Bank A" vuelve a aparecer sin conciliar
```

## Notas

- Depende del contrato ReconciliationStatusQuery.getCoverage de pf-p2c (design.md decisión 2). Cubre "Gasto retroactivo después de conciliar".
