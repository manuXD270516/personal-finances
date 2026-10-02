---
id: TC-LEDGER-BALANCE-001
title: "El dominio rechaza un asiento desbalanceado en cualquier moneda"
spec: ledger/journal-posting
related_specs: []
requirement: "Asientos balanceados por moneda"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-001]
nfr: []
invariants: [INV-004, INV-002]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["ledger", "multi-currency"]
error_code: "LEDGER_UNBALANCED_ENTRY"
preconditions:
  - "Existen las cuentas contables: Bank A (BOB), USD Savings (USD), EXPENSE:BOB"
input:
  - case: "asiento entre monedas «balanceado por valor»"
    postings: ["USD Savings +100.00 USD", "Bank A -690.00 BOB"]
  - case: "misma moneda con diferencia de una unidad menor"
    postings: ["EXPENSE:BOB +100.00 BOB", "Bank A -99.99 BOB"]
steps:
  - "Construir un JournalEntry con los postings indicados"
  - "Intentar validarlo/registrarlo"
expected_result:
  - "Ambos asientos se rechazan con LEDGER_UNBALANCED_ENTRY"
  - "El error lista cada moneda desbalanceada y su residuo (USD +100.00, BOB -690.00; BOB +0.01)"
  - "No se emite ningún evento de dominio"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-BALANCE-001 — El dominio rechaza un asiento desbalanceado en cualquier moneda

## Intención

El balance se verifica por moneda, nunca mediante conversión implícita: un posting en USD no puede compensarse con un posting en BOB sin postings de FX_TRADING en cada moneda.

## Escenario

```gherkin
Dado un asiento con los postings "+100.00 USD" y "-690.00 BOB"
Cuando se registra el asiento
Entonces se rechaza con el código "LEDGER_UNBALANCED_ENTRY"
  Y no se persiste ningún posting
```
