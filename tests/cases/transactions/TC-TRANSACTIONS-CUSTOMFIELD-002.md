---
id: TC-TRANSACTIONS-CUSTOMFIELD-002
title: "El listado de transacciones filtra por valor de custom field"
spec: transactions/transaction-recording
related_specs: ["classification/custom-fields"]
requirement: "Listado y filtrado de transacciones"
scenario: null
requirement_status: confirmed
fr: [FR-TRANSACTIONS-012, FR-CLASSIFICATION-009]
nfr: [NFR-PERF-001]
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/custom-fields.api.test.ts
  - tests/e2e/specs/custom-fields.spec.ts
  - apps/web/src/ui/custom-fields/custom-fields.test.tsx
status: automated
regression_suite: false
phase: 2
tags: ["custom-fields", "list", "modified"]
error_code: null
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Marzo de 2026: gastos de 45.90 y 150.00 BOB con \"oficina\"; gasto de 200.00 BOB con \"casa\""
input:
  query: "customField[centro_costo]=oficina&from=2026-03-01&to=2026-03-31"
steps:
  - "GET W/transactions con el filtro"
expected_result:
  - "Devuelve solo los gastos de 45.90 y 150.00 BOB"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-CUSTOMFIELD-002 — El listado de transacciones filtra por valor de custom field

## Intención

Requirement MODIFIED "Listado y filtrado de transacciones".

## Escenario

```gherkin
Dado gastos de marzo con "centro_costo" "oficina" y "casa"
Cuando el usuario filtra por "centro_costo" = "oficina"
Entonces obtiene solo los gastos de 45.90 BOB y 150.00 BOB
```

## Notas

- scenario: null porque el scenario nuevo vive en el delta MODIFIED; al archivar, enlazar "Filtrar por centro de costo".
