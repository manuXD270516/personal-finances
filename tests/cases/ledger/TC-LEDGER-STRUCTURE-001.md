---
id: TC-LEDGER-STRUCTURE-001
title: El dominio rechaza asientos con menos de dos postings o con un posting en cero
spec: ledger/journal-posting
related_specs: []
requirement: Asiento con al menos dos postings distintos de cero
scenario: Asiento con un solo posting
requirement_status: confirmed
fr: [FR-LEDGER-001]
nfr: [NFR-DATA-004]
invariants: [INV-005]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/domain/journal-entry.test.ts
status: automated
regression_suite: true
phase: 1
tags: [ledger, structure]
error_code: LEDGER_ENTRY_TOO_FEW_POSTINGS
preconditions:
- Cuentas contables EXPENSE:BOB, Efectivo BOB (ASSET, BOB), EQUITY:ADJUSTMENTS:BOB
input:
- case: un solo posting
  postings:
  - EXPENSE:BOB +150.00 BOB
  expected: LEDGER_ENTRY_TOO_FEW_POSTINGS
- case: sin postings
  postings: []
  expected: LEDGER_ENTRY_TOO_FEW_POSTINGS
- case: posting en cero
  postings:
  - EXPENSE:BOB +150.00 BOB
  - Efectivo BOB -150.00 BOB
  - EQUITY:ADJUSTMENTS:BOB 0.00 BOB
  expected: LEDGER_ZERO_AMOUNT_POSTING
steps:
- Construir un JournalEntry con cada conjunto de postings
- Validarlo con EntryValidator
expected_result:
- Los casos 1 y 2 se rechazan con LEDGER_ENTRY_TOO_FEW_POSTINGS
- El caso 3 se rechaza con LEDGER_ZERO_AMOUNT_POSTING aunque la suma en BOB sea 0.00
- No se emite ningún evento ni se persiste nada
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-STRUCTURE-001 — El dominio rechaza asientos con menos de dos postings o con un posting en cero

## Intención

INV-005: un asiento con un solo posting no puede balancear de forma significativa y un posting en cero es ruido que rompe la reconciliación legs = postings.

## Escenario

```gherkin
Dado un asiento con un único posting de +150.00 BOB en "EXPENSE:BOB"
Cuando se registra el asiento
Entonces se rechaza con el código "LEDGER_ENTRY_TOO_FEW_POSTINGS"
```

## Notas

- La barrera de base de datos se verifica en TC-LEDGER-STRUCTURE-002.
