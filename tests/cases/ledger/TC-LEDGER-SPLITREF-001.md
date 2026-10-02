---
id: TC-LEDGER-SPLITREF-001
title: Los postings a INCOME y EXPENSE deben referenciar su split
spec: ledger/journal-posting
related_specs: []
requirement: Postings nominales referencian su split
scenario: Posting de gasto sin split
requirement_status: confirmed
fr: [FR-LEDGER-008]
nfr: []
invariants: [INV-021]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [ledger, splits]
error_code: LEDGER_SPLIT_REQUIRED
preconditions:
- Bank A (BOB) con saldo 1000.00 BOB
- Transacción T1 con splits s1 220.00, s2 50.00, s3 30.00 BOB
input:
- case: gasto dividido
  postings:
  - EXPENSE:BOB +220.00 (s1)
  - EXPENSE:BOB +50.00 (s2)
  - EXPENSE:BOB +30.00 (s3)
  - Bank A -300.00
- case: gasto sin split
  postings:
  - EXPENSE:BOB +15.00 (sin split)
  - Bank A -15.00
steps:
- Registrar ambos asientos
- Repetir el segundo vía SQL directo con pf_app
expected_result:
- El gasto dividido se acepta y cada posting nominal conserva su split
- El gasto sin split se rechaza con LEDGER_SPLIT_REQUIRED
- La base de datos rechaza el posting nominal sin split por el CHECK correspondiente
- El ledger no almacena ninguna categoría
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-SPLITREF-001 — Los postings a INCOME y EXPENSE deben referenciar su split

## Intención

La clasificación vive fuera del ledger; el split es el puente que permite recategorizar sin tocar asientos (INV-033).

## Escenario

```gherkin
Dado un asiento con +15.00 BOB en "EXPENSE:BOB" sin split y -15.00 BOB en "Bank A"
Cuando se registra el asiento
Entonces se rechaza con el código "LEDGER_SPLIT_REQUIRED"
```
