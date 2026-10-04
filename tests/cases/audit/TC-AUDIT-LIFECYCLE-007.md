---
id: TC-AUDIT-LIFECYCLE-007
title: "El recorrido de una transferencia corregida muestra completada y revisada con sus montos"
spec: audit/lifecycle-timeline
related_specs: ["transactions/transfers"]
requirement: "Recorrido de una transferencia"
scenario: "Transferencia corregida"
requirement_status: confirmed
fr: ["FR-AUDIT-010","FR-TRANSACTIONS-018","FR-TRANSACTIONS-036"]
nfr: []
invariants: ["INV-009"]
priority: high
type: api
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle.api.test.ts
  - packages/contexts/transactions/src/application/transfers.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle","transfer"]
error_code: null
preconditions:
  - "\"A\" con 1000.00 BOB y \"B\" con 0.00 BOB"
input: {"transfer":{"from":"A","to":"B","amount":"300.00","currency":"BOB"},"revise":{"amount":"250.00"}}
steps:
  - "Registrar la transferencia posteada"
  - "Corregir el monto a 250.00 BOB"
  - "Consultar el recorrido y los saldos"
expected_result:
  - "RECORD (∅ → posted, revisión 1, 300.00 BOB, events incluye transactions.TransferCompleted.v1)"
  - "REVISE (posted → posted, revisión 1 → 2, 250.00 BOB, events incluye transactions.TransferRevised.v1)"
  - "\"A\" 750.00 BOB, \"B\" 250.00 BOB; patrimonio 1000.00 BOB"
created: 2026-10-03
updated: 2026-10-04
---

# TC-AUDIT-LIFECYCLE-007 — El recorrido de una transferencia corregida muestra completada y revisada con sus montos

## Intención

El recorrido de una transferencia hace visible la semántica de eventos decidida en D37.

## Escenario

```gherkin
Dada una transferencia de 300.00 BOB de "A" a "B"
Cuando corrijo su monto a 250.00 BOB
Entonces el recorrido muestra completada (300.00 BOB) y revisada (250.00 BOB)
  Y los saldos son 750.00 BOB y 250.00 BOB
```

## Notas

- Los montos por revisión se componen con la query pública de Transactions.
