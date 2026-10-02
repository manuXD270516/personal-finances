---
id: TC-LEDGER-TRANSFER-001
title: "La transferencia entre cuentas propias preserva el patrimonio neto y mantiene el ledger balanceado"
spec: transactions/transfers
related_specs: ["ledger/journal-posting", "ledger/balances"]
requirement: "Transferencia entre cuentas propias"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-003, FR-LEDGER-001]
nfr: []
invariants: [INV-001, INV-009, INV-004]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["transfer", "net-worth", "ledger"]
error_code: null
preconditions:
  - "Workspace W1 con moneda base BOB"
  - "Cuenta A (ASSET, BOB) con saldo 1000.00 BOB"
  - "Cuenta B (ASSET, BOB) con saldo 0.00 BOB"
  - "Sin transacciones pendientes ni de otro tipo"
input:
  from: "Cuenta A"
  to: "Cuenta B"
  amount: "300.00"
  currency: "BOB"
  date: "2026-03-15"
steps:
  - "Registrar una transferencia de 300.00 BOB de la Cuenta A a la Cuenta B"
  - "Leer los saldos de A y B desde el ledger"
  - "Calcular el patrimonio neto en BOB antes y después"
expected_result:
  - "Se crea exactamente un JournalEntry con dos postings: Cuenta B +300.00 BOB, Cuenta A -300.00 BOB"
  - "La suma de los postings en BOB es 0.00"
  - "Saldo de la Cuenta A = 700.00 BOB"
  - "Saldo de la Cuenta B = 300.00 BOB"
  - "Patrimonio neto antes = patrimonio neto después = 1000.00 BOB"
  - "No se crea ningún posting de INCOME ni de EXPENSE"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-TRANSFER-001 — La transferencia entre cuentas propias preserva el patrimonio neto y mantiene el ledger balanceado

## Intención

Una transferencia mueve dinero entre las cuentas propias del usuario; nunca debe crear ni destruir valor (INV-009) y todo asiento debe balancear por moneda (INV-004). Este es el ejemplo canónico de ARCHITECTURE §12.

## Escenario

```gherkin
Dado que la cuenta "A" tiene un saldo de 1000.00 BOB
  Y la cuenta "B" tiene un saldo de 0.00 BOB
Cuando el usuario transfiere 300.00 BOB de "A" a "B" el 2026-03-15
Entonces la cuenta "A" tiene un saldo de 700.00 BOB
  Y la cuenta "B" tiene un saldo de 300.00 BOB
  Y el patrimonio neto sigue siendo 1000.00 BOB
  Y los postings del asiento suman 0.00 BOB
```

## Notas

- Datos: cuentas del Minimal Seed "Bank A" / "Bank B" (docs/29).
- Una variante basada en propiedades (montos aleatorios dentro del saldo disponible) pertenece al mismo TC.
