---
id: TC-TRANSACTIONS-RECONCILIATION-014
title: "Marcar reconciled fuera de una sesión se rechaza"
spec: transactions/reconciliation
related_specs: []
requirement: "Marcar una transacción como reconciliada"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-006, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-023]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["reconciled", "modified"]
error_code: "RECONCILIATION_SESSION_REQUIRED"
preconditions:
  - "Gasto cleared de 150.00 BOB en \"Bank A\""
input:
  patch: {"status":"RECONCILED"}
steps:
  - "PATCH W/transactions/{id} con status RECONCILED e If-Match vigente"
expected_result:
  - "409 RECONCILIATION_SESSION_REQUIRED"
  - "El gasto sigue cleared"
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-RECONCILIATION-014 — Marcar reconciled fuera de una sesión se rechaza

## Intención

Requirement MODIFIED: reconciled solo se alcanza finalizando una sesión (pregunta abierta 2 de add-reconciliation). Reemplaza la expectativa de TC-TRANSACTIONS-RECONCILED-001 al implementarse.

## Escenario

```gherkin
Dado un gasto cleared de 150.00 BOB
Cuando el usuario lo marca directamente como reconciled
Entonces se rechaza con "RECONCILIATION_SESSION_REQUIRED"
  Y el gasto sigue cleared
```

## Notas

- scenario: null porque el scenario nuevo vive en el delta MODIFIED; al archivar, enlazar "Marcado directo como reconciliada".
