---
id: TC-TRANSACTIONS-CUSTOMFIELD-001
title: "La transacción devuelve exactamente los custom fields de cada split"
spec: transactions/transaction-recording
related_specs: ["classification/custom-fields"]
requirement: "Datos de la transacción"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-002, FR-TRANSACTIONS-003, FR-TRANSACTIONS-026]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["custom-fields", "round-trip", "modified"]
error_code: null
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Custom field de transacción \"factura\" (TEXT)"
input:
  amount: "45.90"
  account: "Bank A"
  splits: [{"category":"Groceries","amount":"45.90","customFields":{"centro_costo":"casa","factura":"F-001234"}}]
steps:
  - "Registrar el gasto"
  - "GET W/transactions/{id}"
expected_result:
  - "El split devuelve centro_costo = \"casa\" y factura = \"F-001234\""
  - "El resto de los campos de \"Ida y vuelta de todos los campos\" se conserva"
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-CUSTOMFIELD-001 — La transacción devuelve exactamente los custom fields de cada split

## Intención

Requirement MODIFIED "Datos de la transacción": los custom fields forman parte de la ida y vuelta.

## Escenario

```gherkin
Dado los custom fields "centro_costo" y "factura"
Cuando el usuario registra un gasto de 45.90 BOB con ambos valores en su split
Entonces al consultarlo el split devuelve exactamente esos valores
```

## Notas

- scenario: null porque el scenario nuevo vive en el delta MODIFIED; al archivar, enlazar "Ida y vuelta con custom fields".
