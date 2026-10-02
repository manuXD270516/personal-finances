---
id: TC-LEDGER-MONEY-007
title: Se rechazan la aritmética y la comparación entre monedas distintas
spec: ledger/journal-posting
related_specs: []
requirement: Operaciones monetarias solo entre la misma moneda
scenario: Suma de BOB y USD
requirement_status: confirmed
fr: [FR-LEDGER-007]
nfr: []
invariants: [INV-002]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [money, multi-currency]
error_code: CURRENCY_MISMATCH
preconditions:
- 'Arbitraries: dos monedas distintas c1 != c2'
input:
  example:
    a: 10.00 BOB
    b: 10.00 USD
  operations:
  - add
  - subtract
  - compare
  - equals-with-amount
steps:
- Aplicar cada operación a un Money en c1 y un Money en c2
expected_result:
- add/subtract/compare lanzan CURRENCY_MISMATCH
- equals devuelve false (nunca lanza, nunca compara solo los montos)
- Las operaciones en la misma moneda tienen éxito
created: 2026-10-01
updated: 2026-10-02
---

# TC-LEDGER-MONEY-007 — Se rechazan la aritmética y la comparación entre monedas distintas

## Intención

Las monedas solo pueden relacionarse mediante una conversión explícita con postings de FX_TRADING (INV-002).

## Escenario

```gherkin
Dado 10.00 BOB y 10.00 USD
Cuando se suman
Entonces la operación falla con el código "CURRENCY_MISMATCH"
```
