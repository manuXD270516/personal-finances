---
id: TC-TRANSACTIONS-CLEARED-002
title: "El marcado de cleared en lote es atómico y se audita con un identificador común"
spec: transactions/reconciliation
related_specs: ["audit/audit-trail"]
requirement: "Marcar transacciones como cleared en lote"
scenario: "Lote con una transacción anulada"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-029, FR-AUDIT-001]
nfr: []
invariants: [INV-029]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["cleared", "bulk", "audit"]
error_code: "INVALID_STATUS_TRANSITION"
preconditions:
  - "Gastos posteados A 45.90 BOB, B 150.00 BOB, C 200.00 BOB"
  - "Gasto anulado V 60.00 BOB"
input:
  - items: ["A", "B", "C"]
    cleared: true
  - items: ["A", "B", "V"]
    cleared: true
steps: ["Enviar el primer lote", "Revertir A, B, C a posted", "Enviar el segundo lote"]
expected_result:
  - "Primer lote: A, B y C quedan cleared; tres filas de auditoría con el mismo bulkOperationId"
  - "Segundo lote: 409 INVALID_STATUS_TRANSITION con errors[] apuntando a V; A y B siguen posted"
  - "Una versión obsoleta en cualquier ítem rechaza el lote completo con PRECONDITION_FAILED"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CLEARED-002 — El marcado de cleared en lote es atómico y se audita con un identificador común

## Intención

FR-TRANSACTIONS-029 en lote sin estados parciales.

## Escenario

```gherkin
Dado dos gastos posteados y uno anulado
Cuando el usuario los marca como "cleared" en lote
Entonces se rechaza con el código "INVALID_STATUS_TRANSITION"
  Y ninguno cambia de estado
```
