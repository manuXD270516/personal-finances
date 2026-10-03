---
id: TC-TRANSACTIONS-TRANSFER-003
title: "Una transferencia con el mismo origen y destino se rechaza"
spec: transactions/transfers
related_specs: []
requirement: "Origen y destino distintos"
scenario: "Transferir a la misma cuenta"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-018]
nfr: []
invariants: [INV-004]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transfer.test.ts
  - packages/contexts/transactions/src/application/transfers.service.test.ts
  - packages/contexts/transactions/test/integration/pg-transfers.int.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["transfer", "validation"]
error_code: "TRANSFER_SAME_ACCOUNT"
preconditions: ["Bank A (BOB) con saldo 1000.00 BOB"]
input:
  from: "Bank A"
  to: "Bank A"
  amount: "100.00 BOB"
steps: ["Intentar la transferencia"]
expected_result: ["422 TRANSFER_SAME_ACCOUNT", "Saldo 1000.00 BOB; nada persistido"]
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-TRANSFER-003 — Una transferencia con el mismo origen y destino se rechaza

## Intención

Una transferencia a sí misma no tiene sentido económico y produciría un asiento degenerado.

## Escenario

```gherkin
Dado que "Bank A" tiene 1000.00 BOB
Cuando el usuario transfiere 100.00 BOB de "Bank A" a "Bank A"
Entonces se rechaza con el código "TRANSFER_SAME_ACCOUNT"
```
