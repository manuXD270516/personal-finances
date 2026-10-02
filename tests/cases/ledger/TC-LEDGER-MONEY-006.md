---
id: TC-LEDGER-MONEY-006
title: 'Propiedad: la distribución siempre suma el total con un error acotado por parte'
spec: ledger/journal-posting
related_specs: []
requirement: Distribución determinista por mayor residuo
scenario: null
requirement_status: confirmed
fr: [FR-LEDGER-007]
nfr: [NFR-DATA-003]
invariants: [INV-020]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [fast-check, allocation]
error_code: null
preconditions:
- 'Arbitraries: arbMoney(currency), arreglo no vacío de pesos enteros no negativos con suma positiva'
input:
  numRuns_pr: 100
  numRuns_nightly: 10000
steps:
- Distribuir el total generado con los pesos generados
expected_result:
- Σ partes = total exactamente
- 'Para cada parte: |part - total*w_i/Σw| < 1 unidad menor'
- Cada parte tiene escala <= escala de la moneda
- Distribuir dos veces produce resultados idénticos
- Un peso cero produce una parte cero
created: 2026-10-01
updated: 2026-10-02
---

# TC-LEDGER-MONEY-006 — Propiedad: la distribución siempre suma el total con un error acotado por parte

## Intención

Generaliza TC-LEDGER-MONEY-005; protege las divisiones (splits) (TC-TRANSACTIONS-SPLIT-001) y los futuros cronogramas de amortización.

## Escenario

```gherkin
Dado cualquier total y cualquier lista no vacía de pesos
Cuando se distribuye el total
Entonces las partes suman exactamente el total
  Y cada parte está a menos de una unidad menor de su porción exacta
```
