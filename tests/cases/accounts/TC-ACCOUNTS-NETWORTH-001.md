---
id: TC-ACCOUNTS-NETWORTH-001
title: "Una cuenta excluida del patrimonio neto conserva su saldo pero no suma al patrimonio"
spec: accounts/account-management
related_specs: ["reporting/dashboard"]
requirement: "Inclusión en patrimonio neto"
scenario: "Cuenta excluida"
requirement_status: confirmed
fr: [FR-ACCOUNTS-011]
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["accounts", "net-worth"]
error_code: null
preconditions: ["Workspace W1 con base BOB"]
input:
  - {name: "Bank A", type: "bank", opening: "1000.00", currency: "BOB", includeInNetWorth: "default"}
  - {name: "Préstamo a familiar", type: "manual_asset", opening: "500.00", currency: "BOB", includeInNetWorth: false}
steps: ["Crear las cuentas", "Consultar el patrimonio neto en BOB y los saldos"]
expected_result:
  - "Bank A tiene includeInNetWorth = true por defecto"
  - "Patrimonio neto en BOB = 1000.00 BOB"
  - "El saldo de Préstamo a familiar sigue siendo 500.00 BOB"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-NETWORTH-001 — Una cuenta excluida del patrimonio neto conserva su saldo pero no suma al patrimonio

## Intención

FR-ACCOUNTS-011: el usuario decide qué cuentas cuentan para su patrimonio sin alterar el ledger.

## Escenario

```gherkin
Dado "Bank A" con 1000.00 BOB y "Préstamo a familiar" con 500.00 BOB excluida del patrimonio
Cuando el usuario consulta su patrimonio neto
Entonces es 1000.00 BOB
```
