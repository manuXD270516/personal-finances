---
id: TC-TRANSACTIONS-TRANSFERFEE-001
title: "Una comisión de transferencia en otra moneda se rechaza y no persiste nada"
spec: transactions/transfers
related_specs: ["transactions/conversions"]
requirement: "Transferencia con comisión"
scenario: "Comisión en otra moneda rechazada"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-019]
nfr: []
invariants: [INV-002, INV-004]
priority: medium
type: domain
level: domain
automation_status: not_automated
status: ready
regression_suite: true
phase: 1
tags: ["transfer", "fees", "multi-currency"]
error_code: "TRANSFER_CURRENCY_MISMATCH"
preconditions: ["Bank A (BOB) 2000.00 BOB; Bank B (BOB) 0.00 BOB"]
input:
  from: "Bank A"
  to: "Bank B"
  amount: "1000.00 BOB"
  fee: "1.50 USD"
steps:
  - "Intentar registrar la transferencia con la comisión en USD"
  - "Leer saldos, asientos y outbox"
expected_result:
  - "Rechazo TRANSFER_CURRENCY_MISMATCH con puntero /fee/amount/currency (422 problem+json en la API)"
  - "Saldos sin cambios: Bank A 2000.00 BOB, Bank B 0.00 BOB; sin asiento ni TransferCompleted"
created: 2026-10-04
updated: 2026-10-04
---

# TC-TRANSACTIONS-TRANSFERFEE-001 — Una comisión de transferencia en otra moneda se rechaza y no persiste nada

## Intención

Decisión del owner docs/31 D40: la comisión de una transferencia está siempre en la moneda de la transferencia (INV-002). Una comisión cobrada en otra moneda se registra como conversión (con su fee) o como gasto aparte.

## Escenario

```gherkin
Dado que "Bank A" tiene 2000.00 BOB y "Bank B" 0.00 BOB
Cuando el usuario transfiere 1000.00 BOB con una comisión de 1.50 USD
Entonces se rechaza con el código "TRANSFER_CURRENCY_MISMATCH"
  Y los saldos no cambian y no hay asiento ni evento
```

## Notas

- El rechazo ya está implementado en `Transaction.recordTransfer` (`packages/contexts/transactions/src/domain/transaction.ts`); falta el test con este TC-id (tarea 2.4 de `add-transfers`).
