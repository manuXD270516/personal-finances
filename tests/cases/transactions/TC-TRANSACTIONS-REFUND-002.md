---
id: TC-TRANSACTIONS-REFUND-002
title: "Un reembolso que supera el gasto original exige confirmación explícita"
spec: transactions/transaction-recording
related_specs: []
requirement: "Reembolso que excede el original"
scenario: "Segundo reembolso que supera la compra"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-016]
nfr: []
invariants: [INV-004]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["refund", "validation"]
error_code: "REFUND_EXCEEDS_ORIGINAL"
preconditions: ["Gasto G1 de 200.00 BOB en Groceries", "Reembolso vinculado R1 de 150.00 BOB"]
input:
  - refund: "60.00 BOB"
    refund_of: "G1"
    confirmExcess: false
  - refund: "60.00 BOB"
    refund_of: "G1"
    confirmExcess: true
steps: ["Registrar el reembolso sin confirmación", "Registrarlo con confirmación explícita"]
expected_result:
  - "Sin confirmación: 422 REFUND_EXCEEDS_ORIGINAL; nada persistido"
  - "Con confirmación: 201; total reembolsado 210.00 BOB; gasto neto de Groceries por G1 = -10.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-REFUND-002 — Un reembolso que supera el gasto original exige confirmación explícita

## Intención

FR-TRANSACTIONS-016 exige confirmación explícita para no ocultar errores de carga.

## Escenario

```gherkin
Dado un gasto de 200.00 BOB con un reembolso de 150.00 BOB
Cuando el usuario registra otro reembolso de 60.00 BOB sin confirmar
Entonces se rechaza con el código "REFUND_EXCEEDS_ORIGINAL"
```
