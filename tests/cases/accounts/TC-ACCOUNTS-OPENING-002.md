---
id: TC-ACCOUNTS-OPENING-002
title: "Si el saldo inicial no puede contabilizarse, la cuenta no se crea"
spec: accounts/account-management
related_specs: ["transactions/transaction-recording", "audit/audit-trail"]
requirement: "Apertura de cuenta atómica"
scenario: "Saldo inicial con escala inválida"
requirement_status: confirmed
fr: [FR-ACCOUNTS-004, FR-AUDIT-001]
nfr: []
invariants: [INV-003, INV-029]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["accounts", "opening-balance", "atomicity"]
error_code: "AMOUNT_SCALE_EXCEEDED"
preconditions: ["PostgreSQL mediante Testcontainers; W1 con BOB (escala 2)"]
input: {name: "Bank E", type: "bank", currency: "BOB", opening: "10.005", date: "2026-01-01"}
steps: ["Crear Bank E con el saldo inicial", "Buscar cuenta, transacción, asiento, auditoría y outbox de Bank E"]
expected_result:
  - "La creación se rechaza con AMOUNT_SCALE_EXCEEDED (422)"
  - "No existe la cuenta Bank E, ni transacción OPENING_BALANCE, ni asiento, ni ledger account, ni registro de auditoría, ni evento AccountOpened"
  - "El nombre Bank E queda libre para un nuevo intento"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-OPENING-002 — Si el saldo inicial no puede contabilizarse, la cuenta no se crea

## Intención

La orquestación Accounts + Transactions (ARCHITECTURE §7) debe ser una sola unidad de trabajo: nunca una cuenta sin su saldo declarado.

## Escenario

```gherkin
Cuando el usuario crea "Bank E" con saldo inicial 10.005 BOB
Entonces se rechaza con AMOUNT_SCALE_EXCEEDED
  Y no existe "Bank E" ni ningún efecto asociado
```
