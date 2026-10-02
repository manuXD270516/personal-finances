---
id: TC-TRANSACTIONS-CONVERSION-005
title: "El fee de red pagado en TRX desde otra wallet se registra como gasto en TRX en el mismo asiento"
spec: transactions/conversions
related_specs: ["fx/conversion-pricing","classification/categories"]
requirement: "Comisiones registradas como gasto en su propia moneda"
scenario: "Fee de red pagado en una tercera moneda"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-023","FR-TRANSACTIONS-022"]
nfr: []
invariants: ["INV-004","INV-010","INV-021"]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["conversion","crypto","network-fee","third-currency"]
error_code: null
preconditions:
  - "\"Wallet USDT\" con 1000.000000 USDT"
  - "\"Wallet BTC\" con 0.00000000 BTC"
  - "\"Wallet TRX\" con 50.000000 TRX"
  - "Categoría de sistema Fees"
input: {"source":"1000.000000 USDT","provider_fee":"2.000000 USDT","target":"0.01600000 BTC","network_fee":{"amount":"15.000000 TRX","paidFromAccount":"Wallet TRX"},"date":"2026-09-20"}
steps:
  - "Registrar la conversión USDT → BTC con ambos fees"
  - "Inspeccionar asiento, splits y ConversionDetail"
expected_result:
  - "Postings: Wallet USDT −1000.000000 USDT; FX_TRADING:USDT +998.000000 USDT; Fees +2.000000 USDT (PROVIDER); FX_TRADING:BTC −0.01600000 BTC; Wallet BTC +0.01600000 BTC; Wallet TRX −15.000000 TRX; Fees +15.000000 TRX (NETWORK)"
  - "Σ USDT = 0; Σ BTC = 0; Σ TRX = 0"
  - "Detalle: fees [PROVIDER 2.000000 USDT, NETWORK 15.000000 TRX desde Wallet TRX]; efectiva BTC/USDT 62500; cotizada 62375"
  - "Saldos: Wallet TRX 35.000000 TRX"
created: 2026-10-02
updated: 2026-10-02
---

# TC-TRANSACTIONS-CONVERSION-005 — El fee de red pagado en TRX desde otra wallet se registra como gasto en TRX en el mismo asiento

## Intención

docs/09 §6.15: los fees en una tercera moneda son gasto real en esa moneda y no se compensan en la tasa.

## Escenario

```gherkin
Dado que tengo 1000.000000 USDT y 50.000000 TRX
Cuando convierto a 0.01600000 BTC pagando 2.000000 USDT al proveedor y 15.000000 TRX de red
Entonces el asiento cuadra en USDT, BTC y TRX
  Y los dos fees quedan como gasto Fees en su moneda
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
