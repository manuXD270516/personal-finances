---
id: TC-CLASSIFICATION-TAG-006
title: Añadir un tag a un gasto contabilizado no crea asientos ni cambia saldos
spec: classification/tags
related_specs: [transactions/transaction-recording, ledger/journal-posting]
requirement: Etiquetar no modifica el ledger
scenario: Añadir un tag a un gasto contabilizado
requirement_status: confirmed
fr: [FR-LEDGER-008, FR-TRANSACTIONS-008]
nfr: []
invariants: [INV-033]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [tags, ledger, regression]
error_code: null
preconditions:
- Cuenta "Wallet USDT" con saldo 500.000000 USDT después de un gasto contabilizado de 100.000000 USDT
input:
  add_tag:
    transaction: gasto de 100.000000 USDT
    tag: Trabajo
steps:
- Contar asientos/postings y leer el saldo
- Añadir el tag
- Volver a contar y leer el saldo
expected_result:
- El número de asientos y postings no cambia
- El saldo de "Wallet USDT" sigue siendo 500.000000 USDT
- Se emite transactions.TransactionCategorized.v1 con addedTagIds = [Trabajo]
created: 2026-10-02
updated: 2026-10-02
---

# TC-CLASSIFICATION-TAG-006 — Añadir un tag a un gasto contabilizado no crea asientos ni cambia saldos

## Intención

INV-033: etiquetar nunca toca el ledger.

## Escenario

```gherkin
Dado un gasto contabilizado de 100.000000 USDT desde "Wallet USDT" con saldo 500.000000 USDT
Cuando se le añade el tag "Trabajo"
Entonces no se crean asientos
  Y el saldo sigue siendo 500.000000 USDT
```

## Notas

- Se automatiza cuando exista add-transaction-recording (tasks 7.2).
