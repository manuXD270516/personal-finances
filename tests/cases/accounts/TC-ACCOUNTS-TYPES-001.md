---
id: TC-ACCOUNTS-TYPES-001
title: "Cada tipo de cuenta soportado se crea con la naturaleza activo o pasivo que le corresponde"
spec: accounts/account-management
related_specs: []
requirement: "Tipos de cuenta y su naturaleza"
scenario: "Préstamo es un pasivo"
requirement_status: confirmed
fr: [FR-ACCOUNTS-001, FR-ACCOUNTS-003]
nfr: []
invariants: [INV-030]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/domain/account.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "account-type"]
error_code: "VALIDATION_FAILED"
preconditions: ["Workspace W1 con BOB y USDT habilitadas"]
input:
  asset_types: [bank, cash, digital_wallet, crypto_wallet, investment, savings, virtual, manual_asset]
  liability_types: [credit_card, loan, manual_liability]
  invalid_type: "checking"
steps:
  - "Crear una cuenta en BOB (USDT para crypto_wallet) por cada tipo"
  - "Intentar crear una cuenta de tipo checking"
expected_result:
  - "Las 8 cuentas de asset_types quedan activas con naturaleza ASSET y saldo cero"
  - "Las 3 cuentas de liability_types quedan activas con naturaleza LIABILITY"
  - "El tipo checking se rechaza con VALIDATION_FAILED y no se crea cuenta"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-TYPES-001 — Cada tipo de cuenta soportado se crea con la naturaleza activo o pasivo que le corresponde

## Intención

La naturaleza decide el signo contable y el patrimonio neto; un tipo mal mapeado invierte saldos (FR-ACCOUNTS-001/003).

## Escenario

```gherkin
Cuando el usuario crea la cuenta "Préstamo vehicular" de tipo loan en BOB
Entonces la cuenta tiene naturaleza pasivo
```

## Notas

- Prueba parametrizada sobre los 11 tipos de docs/01.
