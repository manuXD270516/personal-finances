---
id: TC-CLASSIFICATION-COUNTERPARTY-005
title: Cambiar la counterparty de un gasto contabilizado no crea asientos ni cambia saldos
spec: classification/counterparties
related_specs: [transactions/transaction-recording, ledger/journal-posting]
requirement: Cambiar la counterparty no modifica el ledger
scenario: Cambiar la counterparty de un gasto contabilizado
requirement_status: confirmed
fr: [FR-TRANSACTIONS-008]
nfr: []
invariants: [INV-033]
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/classification-ledger.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: [counterparties, ledger, regression]
error_code: null
preconditions:
- Cuenta "Efectivo USD" con saldo 300.00 USD después de un gasto contabilizado de 45.00 USD con counterparty "Hipermaxi"
input:
  change_counterparty:
    from: Hipermaxi
    to: Fidalga
steps:
- Contar asientos/postings y leer el saldo
- Cambiar la counterparty
- Volver a contar y leer el saldo
expected_result:
- El número de asientos y postings no cambia
- El saldo de "Efectivo USD" sigue siendo 300.00 USD
- La auditoría registra la counterparty anterior y la nueva
created: 2026-10-02
updated: 2026-10-04
---

# TC-CLASSIFICATION-COUNTERPARTY-005 — Cambiar la counterparty de un gasto contabilizado no crea asientos ni cambia saldos

## Intención

FR-TRANSACTIONS-008: editar solo clasificación (incl. payee) no toca el ledger.

## Escenario

```gherkin
Dado un gasto contabilizado de 45.00 USD con counterparty "Hipermaxi"
Cuando se cambia a "Fidalga"
Entonces no se crean asientos
  Y el saldo de "Efectivo USD" sigue siendo 300.00 USD
```

## Notas

- Se automatiza cuando exista add-transaction-recording (tasks 7.2).
- Automatizado 2026-10-04 (add-classification 7.2).
