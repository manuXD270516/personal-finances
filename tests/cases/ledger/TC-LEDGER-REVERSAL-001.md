---
id: TC-LEDGER-REVERSAL-001
title: El asiento de reversa niega cada posting del original y se vincula a él
spec: ledger/journal-posting
related_specs: []
requirement: Correcciones mediante asientos de reversa
scenario: Reversa de un gasto
requirement_status: confirmed
fr: [FR-LEDGER-005]
nfr: []
invariants: [INV-008, INV-004, INV-007]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [reversal, immutability]
error_code: null
preconditions:
- Cuenta Bank A (BOB) con saldo 1000.00 BOB
- 'Asiento E1 con fecha 2026-03-10: EXPENSE:BOB +120.00 (división Groceries), Bank A -120.00'
input:
  reverse: E1
  reversal_date: '2026-03-20'
steps:
- Reversar el asiento E1
- Inspeccionar el nuevo asiento y E1
- Leer el saldo de Bank A
expected_result:
- Existe un nuevo asiento R1 de tipo REVERSAL con reverses_entry_id = E1
- 'Postings de R1: EXPENSE:BOB -120.00 (split Groceries), Bank A +120.00 (mismas cuentas contables y referencias de split, signos opuestos)'
- E1 no cambia
- Saldo de Bank A = 1000.00 BOB
- La suma por (cuenta, split, moneda) de E1 + R1 es 0.00 BOB
created: 2026-10-01
updated: 2026-10-02
---

# TC-LEDGER-REVERSAL-001 — El asiento de reversa niega cada posting del original y se vincula a él

## Intención

Las correcciones nunca mutan el historial (ARCHITECTURE §4.1); la reversa debe ser una negación exacta para que los saldos vuelvan a su estado anterior.

## Escenario

```gherkin
Dado que el asiento "E1" registra +120.00 BOB en EXPENSE y -120.00 BOB en "Bank A"
Cuando se reversa "E1" el 2026-03-20
Entonces un nuevo asiento reversa "E1" con +120.00 BOB en "Bank A" y -120.00 BOB en EXPENSE
  Y "E1" no cambia
  Y "Bank A" tiene un saldo de 1000.00 BOB
```
