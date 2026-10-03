---
id: TC-LEDGER-SIGN-001
title: Los débitos se registran positivos y los créditos negativos
spec: ledger/journal-posting
related_specs: []
requirement: Convención de signo débito positivo y crédito negativo
scenario: Compra con tarjeta de crédito
requirement_status: confirmed
fr: [FR-LEDGER-002]
nfr: []
invariants: [INV-004]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/domain/journal-entry.test.ts
status: automated
regression_suite: true
phase: 1
tags: [ledger, sign-convention]
error_code: null
preconditions:
- Efectivo BOB (ASSET, BOB) con saldo 500.00 BOB
- Visa BOB (LIABILITY, BOB) con saldo contable 0.00 BOB
input:
- case: gasto en efectivo
  amount: '150.00'
  currency: BOB
- case: compra con tarjeta
  amount: '350.00'
  currency: BOB
steps:
- Construir los asientos de ambos casos
- Calcular el saldo contable de cada cuenta
expected_result:
- 'Gasto: EXPENSE:BOB +150.00 BOB, Efectivo BOB -150.00 BOB; saldo de Efectivo BOB = 350.00 BOB'
- 'Compra: EXPENSE:BOB +350.00 BOB, Visa BOB -350.00 BOB; saldo contable de Visa BOB = -350.00 BOB'
- Cada asiento suma 0.00 BOB
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-SIGN-001 — Los débitos se registran positivos y los créditos negativos

## Intención

FR-LEDGER-002: una convención de signo única hace que saldo = Σ postings para cualquier naturaleza de cuenta.

## Escenario

```gherkin
Dado la tarjeta "Visa BOB" (pasivo) con saldo contable 0.00 BOB
Cuando se registra una compra de 350.00 BOB con "Visa BOB"
Entonces el asiento contiene +350.00 BOB en "EXPENSE:BOB" y -350.00 BOB en "Visa BOB"
  Y el saldo contable de "Visa BOB" es -350.00 BOB
```
