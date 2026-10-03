---
id: TC-TRANSACTIONS-INCOME-001
title: "Un ingreso posteado aumenta el saldo de la cuenta y se reconoce en su categoría"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting"]
requirement: "Registro de un ingreso"
scenario: "Salario depositado en el banco"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-001, FR-TRANSACTIONS-007]
nfr: []
invariants: [INV-004, INV-021]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["income", "ledger"]
error_code: null
preconditions: ["Bank A (ASSET, BOB) con saldo 1000.00 BOB", "Categoría de ingreso \"Salary\" activa"]
input:
  kind: "INCOME"
  account: "Bank A"
  amount: "8000.00"
  currency: "BOB"
  category: "Salary"
  date: "2026-03-01"
  status: "posted"
steps:
  - "Registrar el ingreso"
  - "Leer el saldo de Bank A y el asiento generado"
  - "Consultar ingresos de marzo de 2026 por categoría"
expected_result:
  - "Asiento: Bank A +8000.00 BOB; INCOME:BOB -8000.00 BOB con referencia al split de \"Salary\""
  - "Suma de postings en BOB = 0.00"
  - "Saldo de Bank A = 9000.00 BOB"
  - "Ingreso de marzo de 2026 en \"Salary\" = 8000.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-INCOME-001 — Un ingreso posteado aumenta el saldo de la cuenta y se reconoce en su categoría

## Intención

Patrón de postings del ingreso (docs/09 §6.1): sin él, los ingresos no se reflejarían en saldos ni en el Home (Q2).

## Escenario

```gherkin
Dado que "Bank A" tiene un saldo de 1000.00 BOB
Cuando el usuario registra un ingreso posteado de 8000.00 BOB en "Salary" el 2026-03-01
Entonces el saldo de "Bank A" es 9000.00 BOB
  Y el ingreso de marzo en "Salary" es 8000.00 BOB
  Y el asiento suma 0.00 BOB
```

## Notas

- Datos: Minimal Seed (docs/29).
