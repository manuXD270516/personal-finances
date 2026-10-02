---
id: TC-TRANSACTIONS-PAYMETHOD-002
title: Una transacción sin medio de pago se registra normalmente
spec: transactions/transaction-recording
related_specs: []
requirement: Medio de pago de la transacción
scenario: Medio de pago ausente
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-034
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- payment-method
error_code: null
preconditions:
- EDITOR autenticado de W1
- Cash (BOB) con saldo 100.00 BOB
steps:
- Registrar gasto 20.00 BOB en Cash sin paymentMethod
- Consultar la transacción y el saldo
expected_result:
- paymentMethod es null
- Cash queda en 80.00 BOB
created: '2026-10-02'
updated: '2026-10-02'
---

# TC-TRANSACTIONS-PAYMETHOD-002 — Una transacción sin medio de pago se registra normalmente

## Intención

Decisión del owner 2026-10-02 (D27, docs/31).

## Escenario

```gherkin
Dado "Cash" con 100.00 BOB
Cuando registro un gasto de 20.00 BOB sin medio de pago
Entonces la transacción tiene medio de pago vacío
Y "Cash" queda en 80.00 BOB
```
