---
id: TC-TRANSACTIONS-DUPLICATE-001
title: "Una transacción probablemente duplicada se marca y nunca se elimina automáticamente"
spec: transactions/duplicate-detection
related_specs: []
requirement: "Detección de duplicados"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-008]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["duplicates"]
error_code: null
preconditions:
  - "Gasto registrado (posted) en Bank A: 45.90 BOB, contraparte \"Supermercado Demo\", fecha 2026-03-10"
  - "Ventana de duplicados (provisional): misma cuenta, monto y contraparte dentro de ±2 días"
input:
  account: "Bank A"
  amount: "45.90 BOB"
  counterparty: "Supermercado Demo"
  date: "2026-03-11"
steps:
  - "Registrar el nuevo gasto"
  - "Listar las transacciones marcadas como posibles duplicados"
  - "Descartar la marca"
expected_result:
  - "La nueva transacción se registra y queda en estado posted"
  - "Se marca como possible_duplicate y se vincula al duplicado candidato"
  - "Ambas transacciones permanecen; nada se elimina ni se fusiona automáticamente"
  - "Tras el descarte, la marca se elimina y el par no vuelve a marcarse"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-DUPLICATE-001 — Una transacción probablemente duplicada se marca y nunca se elimina automáticamente

## Intención

La detección de duplicados asiste al usuario; nunca debe alterar silenciosamente los datos financieros.

## Escenario

```gherkin
Dado un gasto de 45.90 BOB en "Supermercado Demo" el 2026-03-10
Cuando se registra otro gasto de 45.90 BOB en "Supermercado Demo" el 2026-03-11
Entonces el nuevo gasto se marca como posible duplicado
  Y ambos gastos permanecen registrados
```
