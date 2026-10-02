---
id: TC-TRANSACTIONS-DATES-001
title: "El asiento usa la fecha de negocio y la fecha de posteo bancaria es solo informativa"
spec: transactions/transaction-recording
related_specs: ["ledger/balances"]
requirement: "Fecha de negocio y fecha de posteo"
scenario: "Gasto de fin de mes posteado por el banco al mes siguiente"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-002, FR-LEDGER-009]
nfr: [NFR-USAB-004]
invariants: [INV-022]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["dates", "timezone", "balances"]
error_code: null
preconditions: ["Workspace con zona horaria America/La_Paz", "Bank A (BOB) con saldo 1000.00 BOB"]
input:
  amount: "200.00 BOB"
  businessDate: "2026-03-31"
  postingDate: "2026-04-02"
steps:
  - "Registrar el gasto posteado"
  - "Leer el entryDate del asiento"
  - "Leer el saldo as-of 2026-03-31 y los gastos de marzo y abril"
expected_result:
  - "entryDate del asiento = 2026-03-31"
  - "Saldo de Bank A al 2026-03-31 = 800.00 BOB"
  - "El gasto cuenta en marzo de 2026 (200.00 BOB) y no en abril de 2026"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-DATES-001 — El asiento usa la fecha de negocio y la fecha de posteo bancaria es solo informativa

## Intención

Resuelve la pregunta abierta 1 de docs/01 con la propuesta: fecha contable = fecha de negocio. Evita errores de periodo por la fecha valor bancaria.

## Escenario

```gherkin
Dado que "Bank A" tiene 1000.00 BOB
Cuando el usuario registra un gasto de 200.00 BOB con fecha de negocio 2026-03-31 y fecha de posteo 2026-04-02
Entonces el saldo al 2026-03-31 es 800.00 BOB
  Y el gasto cuenta en marzo
```

## Notas

- Ejecutar con TZ del proceso en UTC para detectar off-by-one (NFR-USAB-004).
