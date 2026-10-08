---
id: TC-PLANNING-COVERAGE-001
title: Los asientos fuera del rango cubierto crean los periodos necesarios mientras no haya cierres
spec: planning/financial-periods
related_specs: []
requirement: Cobertura retroactiva desde la primera actividad
scenario: Saldo inicial anterior a los periodos existentes
requirement_status: confirmed
fr:
  - FR-PLANNING-002
  - FR-LEDGER-011
nfr: []
invariants:
  - INV-015
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags:
  - financial-periods
error_code: null
preconditions:
  - Hoy es 2026-10-05, día de inicio 1
  - Existen los periodos "2026-10" a "2027-01" y ninguno está cerrado
input:
  - kind: opening_balance
    account: Bank C
    amount: "2500.00"
    currency: BOB
    date: 2026-07-01
  - kind: expense
    amount: "300.00"
    currency: BOB
    date: 2027-06-10
  - kind: expense
    amount: "10.00"
    currency: BOB
    date: 2029-01-15
steps:
  - Registrar cada movimiento
  - Ejecutar el proceso de periodos (o el consumidor de JournalEntryPosted)
expected_result:
  - Se crean "2026-07", "2026-08" y "2026-09" en active; "2026-07" va del 2026-07-01 al 2026-07-31
  - Existen en draft todos los periodos de "2027-02" a "2027-06", sin huecos
  - El gasto del 2029-01-15 se registra y no se crean periodos posteriores a "2028-10"
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-COVERAGE-001 — Los asientos fuera del rango cubierto crean los periodos necesarios mientras no haya cierres

## Intención

Todo día con actividad debe pertenecer a un periodo para poder cerrarlo; el horizonte evita crear periodos por fechas erróneas lejanas.

## Escenario

```gherkin
Dado que existen periodos desde "2026-10" y ninguno está cerrado
Cuando se registra un saldo inicial de 2500.00 BOB con fecha 2026-07-01
Entonces se crean "2026-07", "2026-08" y "2026-09" en estado active
```

## Notas

- Con un periodo cerrado la cobertura retroactiva se detiene: lo verifica TC-PLANNING-LOCK-003.
