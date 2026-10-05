---
id: TC-LEDGER-PERIOD-003
title: El bloqueo cubre el rango del periodo financiero y lo anterior al primer periodo bloqueado
spec: ledger/journal-posting
related_specs:
  - planning/month-closing
  - planning/financial-periods
requirement: Los periodos bloqueados rechazan asientos
scenario: Periodo financiero con día de inicio 25
requirement_status: provisional
fr:
  - FR-LEDGER-011
  - FR-PLANNING-005
nfr: []
invariants:
  - INV-015
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - period-closing
  - ADR-0028
error_code: PERIOD_CLOSED
preconditions:
  - Bloqueado el periodo "2026-10" del 2026-10-25 al 2026-11-24 vía LedgerPeriodLockPort con rango
  - Bank A con 1000.00 BOB
  - "En otro workspace: único bloqueo = primer periodo 2026-07-01..2026-07-31 (abierto hacia atrás)"
input:
  - expense: "20.00"
    currency: BOB
    dates:
      - 2026-10-25
      - 2026-11-24
  - expense: "20.00"
    currency: BOB
    dates:
      - 2026-10-24
      - 2026-11-25
  - opening_balance: "500.00"
    currency: BOB
    date: 2026-06-15
steps:
  - Registrar cada asiento por el dominio
  - Insertar los mismos asientos directamente con el rol pf_app
expected_result:
  - 2026-10-25 y 2026-11-24 se rechazan con PERIOD_CLOSED (dominio) y PF004 (BD)
  - 2026-10-24 y 2026-11-25 se aceptan; Bank A queda en 960.00 BOB
  - El saldo inicial del 2026-06-15 se rechaza con PERIOD_CLOSED
created: 2026-10-05
updated: 2026-10-05
---

# TC-LEDGER-PERIOD-003 — El bloqueo cubre el rango del periodo financiero y lo anterior al primer periodo bloqueado

## Intención

ADR-0028: el bloqueo mensual calendario de D10 no sirve para periodos con día de inicio distinto de 1.

## Escenario

```gherkin
Dado que está bloqueado el periodo del 2026-10-25 al 2026-11-24
Cuando se registran gastos de 20.00 BOB con fechas 2026-10-25 y 2026-11-24
Entonces se rechazan con "PERIOD_CLOSED"
Cuando se registran con fechas 2026-10-24 y 2026-11-25
Entonces se aceptan y "Bank A" queda en 960.00 BOB
```

## Notas

- Cubre "Fechas anteriores al primer periodo bloqueado". TC-LEDGER-PERIOD-001/002 (día 1) no cambian.
