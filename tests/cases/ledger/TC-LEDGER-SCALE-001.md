---
id: TC-LEDGER-SCALE-001
title: Se rechaza un monto de posting con más decimales que la escala de la moneda
spec: ledger/journal-posting
related_specs: []
requirement: Escala de montos por moneda
scenario: Montos que exceden la escala
requirement_status: confirmed
fr: [FR-LEDGER-007, FR-TRANSACTIONS-005]
nfr: [NFR-DATA-001]
invariants: [INV-003, INV-001]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: [money, scale]
error_code: AMOUNT_SCALE_EXCEEDED
preconditions:
- 'Escalas de moneda: BOB 2, USD 2, USDT 6, BTC 8'
input:
- amount: '10.125'
  currency: BOB
  expected: rejected
- amount: '1.1234567'
  currency: USDT
  expected: rejected
- amount: '0.00000001'
  currency: BTC
  expected: accepted
- amount: '10.10'
  currency: BOB
  expected: accepted
steps:
- Crear un posting con cada monto
expected_result:
- Los montos que exceden la escala se rechazan con AMOUNT_SCALE_EXCEEDED (sin redondeo silencioso al registrar)
- Los montos dentro de la escala se aceptan sin cambios
- El redondeo ocurre solo en operaciones explícitas de materialización (ver TC-LEDGER-MONEY-003)
created: 2026-10-01
updated: 2026-10-02
---

# TC-LEDGER-SCALE-001 — Se rechaza un monto de posting con más decimales que la escala de la moneda

## Intención

Los montos persistidos usan NUMERIC(38,18), por lo que el dominio es el único guardián de la escala de la moneda (ARCHITECTURE §4.7).

## Escenario

```gherkin
Dado que BOB tiene escala 2
Cuando se crea un posting de 10.125 BOB
Entonces se rechaza con el código "AMOUNT_SCALE_EXCEEDED"
```
