---
id: TC-ACCOUNTS-LIQUIDITY-001
title: "La liquidez de la cuenta tiene un valor por defecto según tipo y solo lo líquido cuenta como dinero disponible"
spec: accounts/account-management
related_specs: ["reporting/dashboard"]
requirement: "Liquidez de la cuenta"
scenario: "Liquidez por defecto y dinero disponible"
requirement_status: confirmed
fr: [FR-ACCOUNTS-011]
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["accounts", "liquidity"]
error_code: null
preconditions:
  - "Bank A (bank, BOB) con 1000.00 BOB"
  - "Inversión (investment, BOB) con 5000.00 BOB"
input:
  defaults_expected: {bank: LIQUID, cash: LIQUID, digital_wallet: LIQUID, crypto_wallet: LIQUID, savings: LIQUID, investment: SEMI_LIQUID, virtual: ILLIQUID, manual_asset: ILLIQUID, credit_card: ILLIQUID, loan: ILLIQUID, manual_liability: ILLIQUID}
  change: {account: "Inversión", liquidity: "LIQUID"}
steps:
  - "Verificar la liquidez por defecto de cada tipo"
  - "Consultar el dinero disponible en BOB"
  - "Marcar Inversión como LIQUID y consultar de nuevo"
expected_result:
  - "Cada tipo recibe la liquidez de defaults_expected"
  - "Dinero disponible en BOB = 1000.00 BOB"
  - "Tras el cambio, dinero disponible en BOB = 6000.00 BOB y no se crea ningún asiento"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-LIQUIDITY-001 — La liquidez de la cuenta tiene un valor por defecto según tipo y solo lo líquido cuenta como dinero disponible

## Intención

ARCHITECTURE §4.1: la liquidez alimenta *safe to spend* y el calendario de caja; un default incorrecto infla el dinero disponible.

## Escenario

```gherkin
Dado "Bank A" con 1000.00 BOB e "Inversión" con 5000.00 BOB
Cuando el usuario consulta su dinero disponible
Entonces es 1000.00 BOB
```
