---
id: TC-LEDGER-VALUATION-001
title: 'Propiedad: el balance de comprobación es cero por moneda y valorizado con cualquier tasa'
spec: ledger/balances
related_specs: [reporting/dashboard]
requirement: Balance de comprobación en cero por moneda
scenario: Identidad de valoración
requirement_status: confirmed
fr: [FR-LEDGER-001, FR-LEDGER-012]
nfr: [NFR-DATA-004]
invariants: [INV-031, INV-004]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [fast-check, valuation, trial-balance]
error_code: null
preconditions:
- 'Arbitraries: secuencia de asientos balanceados sobre BOB(2), USD(2), USDT(6), BTC(8); tasas aleatorias > 0 a BOB'
input:
  numRuns_pr: 100
  numRuns_nightly: 10000
  example:
    entries:
    - OB Bank A +10000.00 BOB / OPENING_BALANCE:BOB -10000.00
    - OB Binance +100.000000 USDT / OPENING_BALANCE:USDT -100.000000
    - conversión -100.000000 USDT, +100.000000 USDT, -690.00 BOB, +685.00 BOB, +5.00 BOB
    rate: 6.95 BOB por USDT
    net_worth: 10685.00 BOB
steps:
- Registrar los asientos generados
- Calcular la suma de saldos por moneda
- Valorizar todos los saldos en BOB con tasas aleatorias (precisión 40)
expected_result:
- Σ saldos por moneda = 0 exactamente
- Σ saldos valorizados = 0 a precisión 40
- Patrimonio neto valorizado = −valor(EQUITY + INCOME + EXPENSE); en el ejemplo 10685.00 BOB
created: &id001 2026-10-02
updated: *id001
---

# TC-LEDGER-VALUATION-001 — Propiedad: el balance de comprobación es cero por moneda y valorizado con cualquier tasa

## Intención

INV-031: como cada asiento balancea por moneda, el ledger completo balancea con cualquier conjunto de tasas; es la base del cálculo de patrimonio de Reporting.

## Escenario

```gherkin
Dado cualquier ledger generado y cualquier conjunto de tasas positivas
Cuando se valorizan todos los saldos en BOB
Entonces la suma es cero
  Y el patrimonio neto es igual a menos el valor de EQUITY, INCOME y EXPENSE
```
