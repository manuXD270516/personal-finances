---
id: TC-TRANSACTIONS-AMOUNT-002
title: "Se rechazan montos cero o negativos en ingresos, gastos, reembolsos y ajustes"
spec: transactions/transaction-recording
related_specs: []
requirement: "Monto positivo obligatorio"
scenario: "Gasto en cero"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-005]
nfr: []
invariants: [INV-005]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["money", "validation"]
error_code: "AMOUNT_NOT_POSITIVE"
preconditions: ["Bank A (BOB) con saldo 1000.00 BOB"]
input:
  - kind: "EXPENSE"
    amount: "0.00"
    currency: "BOB"
  - kind: "INCOME"
    amount: "-5.00"
    currency: "BOB"
steps: ["Registrar cada transacción"]
expected_result:
  - "Ambas se rechazan con AMOUNT_NOT_POSITIVE (422)"
  - "No se persiste nada; saldo de Bank A = 1000.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-AMOUNT-002 — Se rechazan montos cero o negativos en ingresos, gastos, reembolsos y ajustes

## Intención

La dirección la da el tipo; un posting nunca puede ser cero (INV-005).

## Escenario

```gherkin
Dado que "Bank A" tiene 1000.00 BOB
Cuando el usuario registra un gasto de 0.00 BOB
Entonces se rechaza con el código "AMOUNT_NOT_POSITIVE"
```

## Notas

- El "adjustment informativo" en cero de FR-TRANSACTIONS-005 queda fuera de Phase 1 (pregunta abierta del change).
