---
id: TC-TRANSACTIONS-RECONCILED-003
title: "Des-reconciliar exige motivo, devuelve la transacción a cleared y queda auditado"
spec: transactions/reconciliation
related_specs: ["audit/audit-trail"]
requirement: "Des-reconciliación explícita y auditada"
scenario: "Des-reconciliar para corregir un monto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-AUDIT-001]
nfr: []
invariants: [INV-029]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transactions.service.test.ts
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["reconciled", "audit"]
error_code: "VALIDATION_FAILED"
preconditions: ["Gasto T1 reconciled de 150.00 BOB"]
input:
  - action: "unreconcile"
    reason: "monto mal conciliado"
  - action: "unreconcile"
    reason: null
steps:
  - "Des-reconciliar sin motivo"
  - "Des-reconciliar con motivo"
  - "Editar el monto a 155.00 BOB"
expected_result:
  - "Sin motivo: VALIDATION_FAILED; sigue reconciled"
  - "Con motivo: cleared sin modo de conciliación ni marca de seguimiento; auditoría con actor y motivo"
  - "La edición posterior genera reversa + nuevo asiento y deja T1 en posted"
  - "Si la fecha de T1 está en un periodo cerrado: PERIOD_CLOSED y sigue reconciled (docs/33 D65)"
created: 2026-10-02
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILED-003 — Des-reconciliar exige motivo, devuelve la transacción a cleared y queda auditado

## Intención

reconciled→cleared solo vía des-reconciliación explícita (FR-TRANSACTIONS-006).

## Cambio (openspec add-reconciliation, 2026-10-08)

Actualizado a la semántica MODIFIED del requirement "Des-reconciliación explícita y auditada": limpia el modo de
conciliación (docs/33 D74), anota la des-reconciliación en la sesión que la reconcilió sin alterar su resultado
(TC-TRANSACTIONS-RECONCILIATION-015) y se rechaza con `PERIOD_CLOSED` si la fecha de negocio está en un periodo cerrado
(docs/33 D65, TC-TRANSACTIONS-RECONCILIATION-012).

## Escenario

```gherkin
Dado un gasto "reconciled" de 150.00 BOB
Cuando el usuario lo des-reconcilia con motivo "monto mal conciliado"
Entonces queda "cleared"
  Y el historial registra el actor y el motivo
```
