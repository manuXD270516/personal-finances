---
id: TC-LEDGER-BALANCE-003
title: "Propiedad: todo asiento aceptado balancea por moneda y el balance de comprobación siempre es cero"
spec: ledger/journal-posting
related_specs: ["ledger/balances"]
requirement: "Asientos balanceados por moneda"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-001, FR-LEDGER-003]
nfr: []
invariants: [INV-009, INV-004]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["fast-check", "ledger"]
error_code: null
preconditions:
  - "Arbitraries de fast-check arbBalancedEntry() y arbUnbalancedEntry() sobre las monedas BOB(2), USD(2), USDT(6), BTC(8)"
input:
  numRuns_pr: 100
  numRuns_nightly: 10000
  seed: "fija en PR, aleatoria en nightly"
steps:
  - "Generar una secuencia aleatoria de asientos balanceados y desbalanceados"
  - "Registrar cada uno en un ledger en memoria"
  - "Después de cada paso, calcular el balance de comprobación por moneda"
expected_result:
  - "Todo asiento balanceado se acepta; todo asiento desbalanceado en al menos una moneda se rechaza"
  - "Para cada moneda, la suma de los saldos de todas las cuentas contables es 0 después de cada paso"
  - "La suma de los saldos ASSET + LIABILITY solo cambia por asientos que tocan INCOME/EXPENSE/EQUITY"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-BALANCE-003 — Propiedad: todo asiento aceptado balancea por moneda y el balance de comprobación siempre es cero

## Intención

Generaliza TC-LEDGER-BALANCE-001 y TC-LEDGER-TRANSFER-001 a entradas arbitrarias; cualquier contraejemplo se convierte en un ejemplo de regresión fijo.

## Escenario

```gherkin
Dado cualquier secuencia de asientos generados
Cuando se registran en orden
Entonces solo se aceptan los asientos balanceados por moneda
  Y el balance de comprobación por moneda es 0 después de cada paso
```
