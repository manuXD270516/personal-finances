---
id: TC-TRANSACTIONS-TRANSFER-004
title: "La comisión de una transferencia es un gasto en Fees y reduce el patrimonio exactamente en su monto"
spec: transactions/transfers
related_specs: ["ledger/journal-posting", "classification/categories"]
requirement: "Transferencia con comisión"
scenario: "Transferencia interbancaria con comisión"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-019]
nfr: []
invariants: [INV-009, INV-004, INV-021]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transfer.test.ts
  - packages/contexts/transactions/src/application/transfers.service.test.ts
  - packages/contexts/transactions/test/integration/pg-transfers.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["transfer", "fees"]
error_code: null
preconditions: ["Bank A (BOB) 2000.00 BOB; Bank B (BOB) 0.00 BOB", "Categoría de sistema \"Fees\""]
input:
  from: "Bank A"
  to: "Bank B"
  amount: "1000.00 BOB"
  fee: "10.00 BOB"
steps:
  - "Registrar la transferencia con comisión"
  - "Leer asiento, saldos, gasto de Fees y patrimonio"
expected_result:
  - "Un asiento: Bank B +1000.00; EXPENSE:BOB +10.00 (split Fees); Bank A -1010.00; suma 0.00 BOB"
  - "Saldos: Bank A 990.00 BOB, Bank B 1000.00 BOB"
  - "Gasto en Fees +10.00 BOB; patrimonio baja exactamente 10.00 BOB"
  - "TransferCompleted con amount 1000.00 BOB y fee 10.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-TRANSFER-004 — La comisión de una transferencia es un gasto en Fees y reduce el patrimonio exactamente en su monto

## Intención

INV-009: el patrimonio solo cambia por el fee explícito (docs/09 §6.4).

## Escenario

```gherkin
Dado que "Bank A" tiene 2000.00 BOB y "Bank B" 0.00 BOB
Cuando el usuario transfiere 1000.00 BOB con una comisión de 10.00 BOB
Entonces "Bank A" tiene 990.00 BOB y "Bank B" 1000.00 BOB
  Y el patrimonio baja exactamente 10.00 BOB
```
