---
id: TC-TRANSACTIONS-CONVERSION-004
title: "Propiedad: conversiones en las cuatro direcciones producen un asiento que cuadra por moneda"
spec: transactions/conversions
related_specs: ["ledger/journal-posting","fx/conversion-pricing"]
requirement: "Las cuatro direcciones de conversión"
scenario: "Fiat a fiat (USD a BOB)"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-021"]
nfr: ["NFR-DATA-004"]
invariants: ["INV-004","INV-005","INV-010","INV-024"]
priority: critical
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/conversion.test.ts
  - packages/contexts/transactions/src/domain/conversion.properties.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["conversion","fast-check","multi-currency"]
error_code: null
preconditions:
  - "Arbitraries: pares entre BOB, USD, USDT, BTC, ETH en las cuatro direcciones; montos a escala de cada moneda; 0..3 fees en origen, destino o tercera moneda"
input: {"examples":[{"dir":"FIAT→FIAT","source":"100.00 USD","quoted":"6.96","fee":"5.00 BOB BANK","target":"691.00 BOB"},{"dir":"FIAT→CRYPTO","source":"700.00 BOB","quoted":"7.00","fee":"0.100000 USDT PROVIDER","target":"99.900000 USDT"},{"dir":"CRYPTO→FIAT","source":"100.000000 USDT","quoted":"6.90","fee":"5.00 BOB PROVIDER","target":"685.00 BOB"},{"dir":"CRYPTO→CRYPTO","source":"1000.000000 USDT","fee":"2.000000 USDT PROVIDER","target":"0.01600000 BTC"}],"numRuns_pr":100,"numRuns_nightly":10000}
steps:
  - "Traducir cada conversión generada a asiento"
  - "Agrupar postings por moneda y sumar"
expected_result:
  - "∀ conversión: Σ postings por moneda = 0"
  - "USD→BOB: Caja USD −100.00; FX_TRADING:USD +100.00; FX_TRADING:BOB −696.00; Banco BOB +691.00; Fees +5.00 BOB; efectiva 6.91"
  - "Legs de cuentas de usuario = postings de cuentas de usuario (INV-024)"
  - "convertedSource + fees en origen = source; target + fees en destino = grossTarget (INV-010)"
created: 2026-10-02
updated: 2026-10-03
---

# TC-TRANSACTIONS-CONVERSION-004 — Propiedad: conversiones en las cuatro direcciones producen un asiento que cuadra por moneda

## Intención

FR-TRANSACTIONS-021: el mismo traductor debe ser correcto en las cuatro direcciones, no solo en el ejemplo canónico.

## Escenario

```gherkin
Dada cualquier conversión válida entre dos monedas distintas
Cuando se traduce a asiento contable
Entonces cada moneda suma cero
  Y los montos del detalle coinciden con los postings
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
