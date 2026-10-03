---
id: TC-LEDGER-CURRENCY-001
title: Se rechaza un posting cuya moneda difiere de la de su cuenta contable
spec: ledger/journal-posting
related_specs: []
requirement: Moneda del posting igual a la de su cuenta contable
scenario: Posting en USD contra una cuenta en BOB
requirement_status: confirmed
fr: [FR-LEDGER-003]
nfr: []
invariants: [INV-006, INV-002]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/domain/journal-entry.test.ts
status: automated
regression_suite: true
phase: 1
tags: [ledger, multi-currency]
error_code: CURRENCY_MISMATCH
preconditions:
- 'Bank A: cuenta contable ASSET en BOB'
- 'USD Savings: cuenta contable ASSET en USD'
input:
  postings:
  - Bank A +20.00 USD
  - USD Savings -20.00 USD
steps:
- Registrar el asiento en el dominio
- Repetir la inserción vía SQL directo con el rol pf_app
expected_result:
- El dominio rechaza con CURRENCY_MISMATCH aunque la suma en USD sea 0.00
- La base de datos rechaza la inserción por la FK compuesta (ledger_account_id, currency, account_type)
- No se persiste ningún posting
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-CURRENCY-001 — Se rechaza un posting cuya moneda difiere de la de su cuenta contable

## Intención

INV-006: un posting en una moneda distinta a la de su cuenta corrompería los saldos (sumaría USD dentro de un saldo en BOB).

## Escenario

```gherkin
Dado que "Bank A" es una cuenta contable en BOB
Cuando se registra un asiento con +20.00 USD en "Bank A" y -20.00 USD en "USD Savings"
Entonces se rechaza con el código "CURRENCY_MISMATCH"
```
