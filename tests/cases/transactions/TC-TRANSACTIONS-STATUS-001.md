---
id: TC-TRANSACTIONS-STATUS-001
title: "Las transiciones de estado inválidas se rechazan y el estado no cambia"
spec: transactions/transaction-recording
related_specs: []
requirement: "Estados y transiciones válidas"
scenario: "Una transacción posteada no vuelve a pendiente"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006]
nfr: []
invariants: [INV-023]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.properties.test.ts
  - packages/contexts/transactions/src/domain/transaction.test.ts
  - packages/contexts/transactions/test/integration/pg-transactions.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["status", "state-machine"]
error_code: "INVALID_STATUS_TRANSITION"
preconditions:
  - "Gasto T1 posted de 60.00 BOB"
  - "Gasto T2 void de 60.00 BOB"
  - "Gasto T3 posted de 150.00 BOB"
input:
  - transaction: "T1"
    transition: "posted -> pending"
  - transaction: "T2"
    transition: "void -> posted"
  - transaction: "T3"
    transition: "posted -> reconciled"
steps: ["Intentar cada transición"]
expected_result:
  - "Las tres se rechazan con INVALID_STATUS_TRANSITION (409)"
  - "Estados finales: T1 posted, T2 void, T3 posted; sin asientos nuevos"
  - "Test de propiedad: para toda secuencia aleatoria de comandos, solo se observan las transiciones permitidas por FR-TRANSACTIONS-006"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-STATUS-001 — Las transiciones de estado inválidas se rechazan y el estado no cambia

## Intención

La máquina de estados (docs/04 §4.1) protege INV-023; una transición ilegal podría dejar asientos huérfanos.

## Escenario

```gherkin
Dado un gasto posteado de 60.00 BOB
Cuando el usuario intenta pasarlo a "pending"
Entonces se rechaza con el código "INVALID_STATUS_TRANSITION"
  Y su estado sigue "posted"
```
