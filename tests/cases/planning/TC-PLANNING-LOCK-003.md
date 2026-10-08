---
id: TC-PLANNING-LOCK-003
title: Tras cerrar el primer periodo se rechazan fechas anteriores y no se crean periodos hacia atrás
spec: planning/month-closing
related_specs:
  - planning/financial-periods
  - ledger/journal-posting
requirement: Bloqueo del ledger en periodos cerrados
scenario: Fechas anteriores al primer periodo cerrado
requirement_status: confirmed
fr:
  - FR-PLANNING-005
  - FR-PLANNING-002
nfr: []
invariants:
  - INV-015
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - period-closing
error_code: PERIOD_CLOSED
preconditions:
  - '"2026-07" (2026-07-01..2026-07-31) es el primer periodo y está closed'
input:
  opening_balance:
    amount: "1000.00"
    currency: BOB
    date: 2026-06-15
steps:
  - Registrar el saldo inicial
  - Ejecutar el proceso de periodos
expected_result:
  - Se rechaza con PERIOD_CLOSED
  - No existe ningún periodo anterior a "2026-07"
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-LOCK-003 — Tras cerrar el primer periodo se rechazan fechas anteriores y no se crean periodos hacia atrás

## Intención

Un asiento anterior al primer periodo cerrado cambiaría el saldo de apertura de su snapshot en silencio.

## Escenario

```gherkin
Dado que el primer periodo "2026-07" está closed
Cuando se registra un saldo inicial de 1000.00 BOB con fecha 2026-06-15
Entonces se rechaza con "PERIOD_CLOSED"
```

## Notas

- Ver design.md de add-month-closing, decisión 6, y ADR-0028.
