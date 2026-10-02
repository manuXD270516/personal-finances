---
id: TC-LEDGER-CHART-003
title: Las cuentas de sistema por moneda se crean una sola vez bajo demanda
spec: ledger/journal-posting
related_specs: []
requirement: Cuentas de sistema por moneda creadas bajo demanda
scenario: Creación concurrente de la misma cuenta de sistema
requirement_status: confirmed
fr: [FR-LEDGER-004]
nfr: []
invariants: [INV-006]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [ledger, chart-of-accounts, concurrency]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers, workspace W1 sin cuentas de sistema
- Binance USDT (USDT) con saldo 100.000000 USDT; Bank A (BOB) con saldo 1000.00 BOB
input:
- entry: EXPENSE:USDT +0.100000 / Binance USDT -0.100000
- entry: EXPENSE:USDT +2.000000 / Binance USDT -2.000000
- concurrent_entries: 2
  requires: EQUITY:FX_TRADING:BOB
steps:
- Registrar los dos gastos en USDT en secuencia
- Registrar dos asientos concurrentes que necesitan EQUITY:FX_TRADING:BOB por primera vez
expected_result:
- Se crea una sola cuenta EXPENSE:USDT (naturaleza EXPENSE, moneda USDT) y ambos gastos la usan
- Existe una sola cuenta EQUITY:FX_TRADING:BOB y ambos asientos concurrentes se registran contra ella
- Ningún asiento falla por violación de unicidad
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-CHART-003 — Las cuentas de sistema por moneda se crean una sola vez bajo demanda

## Intención

FR-LEDGER-004: las cuentas de sistema se crean bajo demanda y de forma idempotente; duplicarlas partiría saldos de FX_TRADING o EXPENSE.

## Escenario

```gherkin
Dado un workspace sin la cuenta "EQUITY:FX_TRADING:BOB"
Cuando dos asientos concurrentes la necesitan por primera vez
Entonces ambos se registran contra la misma y única cuenta "EQUITY:FX_TRADING:BOB"
```
