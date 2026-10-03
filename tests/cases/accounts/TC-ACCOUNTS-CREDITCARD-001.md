---
id: TC-ACCOUNTS-CREDITCARD-001
title: "La compra con tarjeta de crédito aumenta el pasivo y el pago es una transferencia que conserva el patrimonio neto"
spec: accounts/account-management
related_specs: ["transactions/transfers", "debt/credit-cards"]
requirement: "Tarjeta de crédito como cuenta de pasivo"
scenario: "Compra y pago con tarjeta"
requirement_status: confirmed
fr: [FR-ACCOUNTS-003, FR-ACCOUNTS-002, FR-TRANSACTIONS-003]
nfr: []
invariants: [INV-009, INV-004, INV-030]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - tests/e2e/specs/transfers.spec.ts
status: automated
regression_suite: true
phase: 1
tags: ["credit-card", "liability", "net-worth"]
error_code: null
preconditions:
  - "Bank A (bank, ASSET, BOB) con saldo 1000.00"
  - "Credit Card (credit_card, LIABILITY, BOB) con saldo 0.00"
  - "Patrimonio neto 1000.00 BOB"
input:
  purchase:
    amount: "350.00"
    currency: "BOB"
    category: "Household"
    date: "2026-03-05"
  payment:
    amount: "350.00"
    from: "Bank A"
    to: "Credit Card"
    date: "2026-03-25"
steps:
  - "Registrar la compra con la tarjeta de crédito"
  - "Registrar el pago de la tarjeta desde Bank A"
expected_result:
  - "Asiento de la compra: EXPENSE:BOB +350.00 (Household), Credit Card -350.00; patrimonio neto = 650.00 BOB; la tarjeta adeuda 350.00"
  - "Asiento del pago: Credit Card +350.00, Bank A -350.00; ningún posting de EXPENSE"
  - "Tras el pago: Bank A 650.00, Credit Card 0.00, patrimonio neto sigue en 650.00 BOB"
  - "Gasto de Household en marzo = 350.00 (contado una sola vez, no de nuevo en el pago)"
created: 2026-10-01
updated: 2026-10-03
---

# TC-ACCOUNTS-CREDITCARD-001 — La compra con tarjeta de crédito aumenta el pasivo y el pago es una transferencia que conserva el patrimonio neto

## Intención

Evita el clásico doble conteo del gasto con tarjeta (compra + pago) y verifica las convenciones de signo del pasivo.

## Escenario

```gherkin
Dado que "Bank A" tiene 1000.00 BOB y "Credit Card" adeuda 0.00 BOB
Cuando el usuario compra 350.00 BOB de artículos del hogar con "Credit Card"
  Y luego paga 350.00 BOB desde "Bank A" a "Credit Card"
Entonces "Bank A" tiene 650.00 BOB y "Credit Card" adeuda 0.00 BOB
  Y el gasto de Household de marzo es 350.00 BOB
  Y el pago no cambió el patrimonio neto
```
