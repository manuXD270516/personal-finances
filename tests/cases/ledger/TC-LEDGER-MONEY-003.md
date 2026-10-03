---
id: TC-LEDGER-MONEY-003
title: El redondeo a la escala de la moneda usa HALF_EVEN
spec: ledger/journal-posting
related_specs: []
requirement: Redondeo HALF_EVEN determinista
scenario: Empates en BOB
requirement_status: confirmed
fr: [FR-LEDGER-007]
nfr: [NFR-DATA-002]
invariants: [INV-020]
priority: critical
type: unit
level: unit
automation_status: automated
automated_tests:
  - packages/shared-kernel/src/money/money.ledger.test.ts
status: automated
regression_suite: true
phase: 1
tags: [money, rounding, tdd]
error_code: null
preconditions:
- 'Escalas de moneda: BOB 2, USDT 6, JPY 0'
input:
- value: '2.345'
  currency: BOB
  expected: '2.34'
- value: '2.355'
  currency: BOB
  expected: '2.36'
- value: '2.3451'
  currency: BOB
  expected: '2.35'
- value: '2.344999'
  currency: BOB
  expected: '2.34'
- value: '-2.345'
  currency: BOB
  expected: '-2.34'
- value: '0.005'
  currency: BOB
  expected: '0.00'
- value: '0.015'
  currency: BOB
  expected: '0.02'
- value: '1.0000005'
  currency: USDT
  expected: '1.000000'
- value: '1.0000015'
  currency: USDT
  expected: '1.000002'
- value: '2.5'
  currency: JPY
  expected: '2'
- value: '3.5'
  currency: JPY
  expected: '4'
steps:
- Llamar a Money.roundToScale() para cada valor (test guiado por tabla)
expected_result:
- Cada resultado es exactamente igual al valor esperado
created: 2026-10-01
updated: 2026-10-03
---

# TC-LEDGER-MONEY-003 — El redondeo a la escala de la moneda usa HALF_EVEN

## Intención

HALF_EVEN (redondeo bancario) es el modo canónico (ARCHITECTURE §4.6); los empates van al dígito par, lo que evita un sesgo sistemático.

## Escenario

```gherkin
Dado que BOB tiene escala 2
Cuando se redondea 2.345 BOB
Entonces el resultado es 2.34 BOB
Cuando se redondea 2.355 BOB
Entonces el resultado es 2.36 BOB
```
