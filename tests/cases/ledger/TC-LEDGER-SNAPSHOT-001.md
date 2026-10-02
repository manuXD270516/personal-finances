---
id: TC-LEDGER-SNAPSHOT-001
title: Los snapshots de saldo se invalidan con asientos retroactivos y se reconstruyen idénticos
spec: ledger/balances
related_specs: []
requirement: Snapshots de saldo derivados y reconstruibles
scenario: Asiento retroactivo invalida el snapshot
requirement_status: confirmed
fr: [FR-LEDGER-014]
nfr: [NFR-DATA-009]
invariants: [INV-022]
priority: high
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [balances, snapshot]
error_code: null
preconditions:
- PostgreSQL vía Testcontainers + worker
- Bank A con snapshot al 2026-01-31 de 850.00 BOB (postings +1000.00 el 2026-01-01, -150.00 el 2026-01-31)
input:
  backdated:
    amount: '-20.00'
    currency: BOB
    entry_date: '2026-01-15'
steps:
- Registrar el gasto retroactivo y procesar el job de invalidación
- Consultar el saldo al 2026-01-31
- Borrar todos los snapshots del workspace y ejecutar RebuildBalanceSnapshots
- Comparar con Σ postings
expected_result:
- El snapshot al 2026-01-31 se invalida
- El saldo al 2026-01-31 es 830.00 BOB, incluso antes de que termine el job
- El snapshot reconstruido vale 830.00 BOB y coincide con Σ postings
- Reconstruir dos veces produce filas idénticas
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-SNAPSHOT-001 — Los snapshots de saldo se invalidan con asientos retroactivos y se reconstruyen idénticos

## Intención

Los snapshots son solo caché (ARCHITECTURE §4.1); un snapshot obsoleto nunca debe ganarle a la suma de postings.

## Escenario

```gherkin
Dado un snapshot de "Bank A" al 2026-01-31 de 850.00 BOB
Cuando se registra un gasto de 20.00 BOB con fecha 2026-01-15
Entonces el saldo al 2026-01-31 es 830.00 BOB
  Y coincide con la suma de los postings
```
