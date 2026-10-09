---
id: TC-TRANSACTIONS-BULK-006
title: "El estado cleared en lote sigue las reglas del marcado cleared"
spec: transactions/bulk-edit
related_specs: ["transactions/reconciliation"]
requirement: "Confirmación cleared en lote desde la edición masiva"
scenario: "Desconfirmar un gasto reconciliado"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-TRANSACTIONS-029]
nfr: []
invariants: [INV-033]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
  - packages/contexts/transactions/src/application/bulk-edit.service.test.ts
  - packages/contexts/transactions/src/domain/bulk-edit.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["bulk-edit", "cleared"]
error_code: "TRANSACTION_RECONCILED"
preconditions:
  - "Gastos posted de 45.90 y 150.00 BOB"
  - "Gasto reconciled R de 150.00 BOB y gasto cleared C de 45.90 BOB"
input:
  - "{\"items\":[\"45.90\",\"150.00\"],\"changes\":{\"cleared\":true,\"addTagIds\":[\"revisado\"]}}"
  - "{\"items\":[\"R\",\"C\"],\"changes\":{\"cleared\":false}}"
steps:
  - "Enviar el primer lote"
  - "Enviar el segundo lote"
expected_result:
  - "Ambos cleared con tag \"revisado\"; dos TransactionCleared.v1 con bulkOperationId"
  - "Segundo lote: 409 TRANSACTION_RECONCILED para R; C sigue cleared"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-006 — El estado cleared en lote sigue las reglas del marcado cleared

## Intención

Reutiliza SetClearedStatus para no duplicar reglas de estado.

## Escenario

```gherkin
Dado un gasto reconciled de 150.00 BOB y uno cleared de 45.90 BOB
Cuando el lote "desconfirmar" incluye a ambos
Entonces se rechaza con "TRANSACTION_RECONCILED"
  Y ninguno cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
