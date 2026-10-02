---
id: TC-LEDGER-BALANCES-002
title: El saldo a una fecha incluye solo asientos hasta esa fecha, también los retroactivos
spec: ledger/balances
related_specs: []
requirement: Saldo a una fecha (as-of)
scenario: Asiento con fecha retroactiva
requirement_status: confirmed
fr: [FR-LEDGER-012]
nfr: [NFR-USAB-004]
invariants: [INV-022]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [balances, as-of]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers; zona del workspace America/La_Paz
- 'Bank A (BOB): +1000.00 el 2026-01-01, -150.00 el 2026-01-31, -300.00 el 2026-02-01'
input:
  as_of:
  - '2026-01-30'
  - '2026-01-31'
  - '2026-02-01'
  backdated:
    amount: '-20.00'
    currency: BOB
    entry_date: '2026-01-15'
steps:
- Consultar el saldo a cada fecha
- Registrar el gasto retroactivo
- Consultar de nuevo al 2026-01-31
expected_result:
- 'Saldos: 1000.00 BOB, 850.00 BOB y 550.00 BOB'
- Tras el retroactivo, el saldo al 2026-01-31 es 830.00 BOB
- Con FixedClock en 2026-02-01T02:30:00Z (2026-01-31 22:30 en La Paz) y antes del retroactivo, el saldo actual por defecto se calcula al 2026-01-31 y es 850.00 BOB
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-BALANCES-002 — El saldo a una fecha incluye solo asientos hasta esa fecha, también los retroactivos

## Intención

FR-LEDGER-012: el saldo as-of alimenta el cierre de mes y los reportes; un error de borde de día corrompe ambos.

## Escenario

```gherkin
Dado que "Bank A" tiene +1000.00 BOB el 2026-01-01 y -150.00 BOB el 2026-01-31
Cuando se registra un gasto de 20.00 BOB con fecha 2026-01-15
Entonces el saldo al 2026-01-31 es 830.00 BOB
```
