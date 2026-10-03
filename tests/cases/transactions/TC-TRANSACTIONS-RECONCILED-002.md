---
id: TC-TRANSACTIONS-RECONCILED-002
title: "Una transacción reconciliada rechaza cambios financieros y anulación pero admite recategorizar"
spec: transactions/reconciliation
related_specs: ["transactions/transaction-recording"]
requirement: "Protección de transacciones reconciliadas"
scenario: "Editar el monto de un gasto reconciliado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-TRANSACTIONS-008]
nfr: []
invariants: [INV-007, INV-033]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["reconciled", "protection"]
error_code: "TRANSACTION_RECONCILED"
preconditions: ["Gasto T1 reconciled de 150.00 BOB en Groceries"]
input:
  - action: "editar monto"
    value: "155.00 BOB"
  - action: "anular"
  - action: "recategorizar"
    value: "Household"
steps: ["Ejecutar cada acción sobre T1"]
expected_result:
  - "Editar monto: 409 TRANSACTION_RECONCILED; monto sigue 150.00 BOB"
  - "Anular: 409 TRANSACTION_RECONCILED; estado sigue reconciled"
  - "Recategorizar: 200; sin asientos nuevos"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-RECONCILED-002 — Una transacción reconciliada rechaza cambios financieros y anulación pero admite recategorizar

## Intención

Lo conciliado contra un extracto no debe cambiar por accidente (docs/09 §11).

## Escenario

```gherkin
Dado un gasto "reconciled" de 150.00 BOB
Cuando el usuario intenta cambiar su monto a 155.00 BOB
Entonces se rechaza con el código "TRANSACTION_RECONCILED"
```
