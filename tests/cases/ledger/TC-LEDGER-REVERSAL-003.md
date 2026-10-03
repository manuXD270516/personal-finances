---
id: TC-LEDGER-REVERSAL-003
title: 'Propiedad: original más reversa suma cero por cuenta, split y moneda'
spec: ledger/journal-posting
related_specs: []
requirement: Correcciones mediante asientos de reversa
scenario: Reversa de una conversión multi-moneda
requirement_status: confirmed
fr: [FR-LEDGER-005]
nfr: []
invariants: [INV-008, INV-004]
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/ledger/src/domain/ledger.properties.test.ts
status: automated
regression_suite: true
phase: 1
tags: [fast-check, reversal]
error_code: null
preconditions:
- Arbitrary arbBalancedEntry() sobre BOB(2), USD(2), USDT(6), BTC(8), con splits en postings nominales
input:
  numRuns_pr: 100
  numRuns_nightly: 10000
  example:
  - -100.000000 USDT
  - +100.000000 USDT
  - -690.00 BOB
  - +685.00 BOB
  - +5.00 BOB (s1)
steps:
- Para cada asiento generado e, construir r = reverse(e)
expected_result:
- r es balanceado por moneda
- 'Para cada (cuenta, split, moneda): Σ e + Σ r = 0'
- r tiene el mismo número de postings y las mismas cuentas que e
- reverse(r) está prohibido
created: &id001 2026-10-02
updated: 2026-10-03
---

# TC-LEDGER-REVERSAL-003 — Propiedad: original más reversa suma cero por cuenta, split y moneda

## Intención

Generaliza TC-LEDGER-REVERSAL-001 a asientos multi-moneda arbitrarios.

## Escenario

```gherkin
Dado cualquier asiento balanceado "e"
Cuando se construye su reversa "r"
Entonces "e" más "r" suma cero por cuenta, split y moneda
```
