---
id: TC-TRANSACTIONS-CARDPAYMENT-001
title: "El pago de la tarjeta es una transferencia de activo a pasivo y no cuenta como gasto"
spec: transactions/transfers
related_specs: ["accounts/account-management", "debt/credit-cards"]
requirement: "Pago de tarjeta de crédito como transferencia"
scenario: "Pagar el consumo del mes de la tarjeta"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-018]
nfr: []
invariants: [INV-030, INV-009, INV-004]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/transfers.service.test.ts
  - packages/contexts/transactions/src/domain/transfer.test.ts
  - tests/e2e/specs/transfers.spec.ts
status: automated
regression_suite: true
phase: 1
tags: ["transfer", "credit-card", "net-worth"]
error_code: null
preconditions:
  - "Bank A (ASSET, BOB) 1000.00 BOB"
  - "Credit Card (LIABILITY, BOB) con deuda 350.00 BOB por un gasto en Household del 2026-03-05"
  - "Patrimonio neto 650.00 BOB"
input:
  from: "Bank A"
  to: "Credit Card"
  amount: "350.00 BOB"
  date: "2026-03-25"
steps:
  - "Registrar la transferencia de pago"
  - "Leer asiento, saldos, patrimonio y gasto de marzo"
expected_result:
  - "Asiento: Credit Card +350.00 BOB; Bank A -350.00 BOB; sin postings a EXPENSE ni INCOME"
  - "Bank A 650.00 BOB; deuda de Credit Card 0.00 BOB; patrimonio sigue en 650.00 BOB"
  - "Gasto de marzo en Household sigue en 350.00 BOB (contado una sola vez)"
created: 2026-10-02
updated: 2026-10-03
---

# TC-TRANSACTIONS-CARDPAYMENT-001 — El pago de la tarjeta es una transferencia de activo a pasivo y no cuenta como gasto

## Intención

ARCHITECTURE §4.3: tarjeta = LIABILITY; el pago no es gasto (el gasto se reconoció en la compra).

## Escenario

```gherkin
Dado que "Credit Card" adeuda 350.00 BOB y "Bank A" tiene 1000.00 BOB
Cuando el usuario transfiere 350.00 BOB de "Bank A" a "Credit Card"
Entonces "Bank A" tiene 650.00 BOB y "Credit Card" adeuda 0.00 BOB
  Y el gasto del mes no cambia
```

## Notas

- TC-ACCOUNTS-CREDITCARD-001 cubre el ciclo compra + pago desde accounts/account-management.
