---
id: TC-PLANNING-LOCK-001
title: Un periodo cerrado rechaza registrar, revisar y recategorizar, y la anulación se corrige en el periodo abierto
spec: planning/month-closing
related_specs:
  - ledger/journal-posting
  - transactions/transaction-recording
  - classification/categories
requirement: Bloqueo del ledger en periodos cerrados
scenario: Operaciones sobre un mes cerrado
requirement_status: provisional
fr:
  - FR-PLANNING-005
  - FR-LEDGER-011
nfr: []
invariants:
  - INV-015
priority: critical
type: api
level: api
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
  - '"2026-10" closed; "2026-11" active'
  - Gastos posteados de 80.00 BOB (2026-10-10) y de 25.00 BOB (2026-10-05, categoría "Supermercado")
input:
  - create:
      amount: "45.00"
      currency: BOB
      date: 2026-10-15
  - revise:
      date: 2026-10-10
      from: "80.00"
      to: "85.00"
      currency: BOB
  - recategorize:
      date: 2026-10-05
      to: Hogar
  - create:
      amount: "45.00"
      currency: BOB
      date: 2026-11-01
  - void:
      date: 2026-10-10
      amount: "80.00"
      currency: BOB
      correctInCurrentPeriod: true
steps:
  - Ejecutar cada operación por la API
expected_result:
  - Registrar, revisar y recategorizar en octubre responden 409 PERIOD_CLOSED; los saldos al 2026-10-31 no cambian
  - El gasto del 2026-11-01 se acepta
  - La anulación con correctInCurrentPeriod registra la reversa con fecha 2026-11-01 y el saldo al 2026-10-31 no cambia
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-LOCK-001 — Un periodo cerrado rechaza registrar, revisar y recategorizar, y la anulación se corrige en el periodo abierto

## Intención

INV-015 de punta a punta: el cierre real activa todas las barreras de Phase 1 y la corrección en el periodo abierto.

## Escenario

```gherkin
Dado que "2026-10" está closed
Cuando se intenta registrar un gasto de 45.00 BOB con fecha 2026-10-15
Entonces se rechaza con "PERIOD_CLOSED"
Cuando se anula el gasto de 80.00 BOB del 2026-10-10 corrigiendo en el periodo actual
Entonces la reversa queda con fecha 2026-11-01
```

## Notas

- Cubre "Anulación corregida en el periodo actual". El rechazo de cambios de conciliación lo implementa pf-p2c.
