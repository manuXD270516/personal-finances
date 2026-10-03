---
id: TC-TRANSACTIONS-SPLIT-004
title: "Cambiar los montos de los splits revierte el asiento y crea uno nuevo"
spec: transactions/splits
related_specs: ["ledger/journal-posting"]
requirement: "Cambiar montos de splits repostea la transacción"
scenario: "Mover 20.00 BOB entre categorías de un gasto dividido"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-028]
nfr: []
invariants: [INV-004, INV-008, INV-021]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["splits", "reversal"]
error_code: null
preconditions:
  - "Gasto posteado T1 de 150.00 BOB en Bank A (asiento E1): splits s1 100.00 Groceries, s2 50.00 Household"
input:
  transaction: "T1"
  new_splits:
    Groceries: "80.00"
    Household: "70.00"
steps: ["Reemplazar los splits de T1", "Inspeccionar asientos, splits y totales del mes"]
expected_result:
  - "R1 revierte E1 referenciando s1 y s2; E2 tiene EXPENSE:BOB +80.00 (s3) y +70.00 (s4) y Bank A -150.00"
  - "s1 y s2 quedan como históricos (superseded) y siguen referenciados por E1 y R1"
  - "Saldo de Bank A sin cambios; gasto de marzo: Groceries 80.00 BOB, Household 70.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-SPLIT-004 — Cambiar los montos de los splits revierte el asiento y crea uno nuevo

## Intención

Los montos nominales están en el ledger; cambiarlos exige reversa + nuevo asiento (FR-TRANSACTIONS-028).

## Escenario

```gherkin
Dado un gasto de 150.00 BOB dividido en 100.00 Groceries y 50.00 Household
Cuando el usuario cambia los splits a 80.00 Groceries y 70.00 Household
Entonces se revierte el asiento anterior y se crea uno nuevo
  Y el saldo de la cuenta no cambia
```
