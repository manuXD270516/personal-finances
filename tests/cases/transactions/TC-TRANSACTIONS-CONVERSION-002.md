---
id: TC-TRANSACTIONS-CONVERSION-002
title: "Conversión de cripto a cripto con comisión de red pagada en el activo de origen"
spec: transactions/conversions
related_specs: ["fx/conversion-pricing"]
requirement: "Conversión de moneda con comisiones"
scenario: null
requirement_status: provisional
fr: [FR-TRANSACTIONS-004]
nfr: []
invariants: [INV-001, INV-002, INV-004, INV-011]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["conversion", "crypto", "network-fee"]
error_code: null
preconditions:
  - "BTC Wallet (ASSET, BTC) con saldo 0.01250000 BTC"
  - "USDT Wallet (ASSET, USDT) con saldo 100.000000 USDT"
input:
  sent_total: "0.01250000 BTC"
  network_fee: "0.00050000 BTC"
  converted: "0.01200000 BTC"
  quoted_rate: "50000 USDT por BTC"
  received: "600.000000 USDT"
  date: "2026-04-02"
steps:
  - "Registrar la conversión BTC → USDT con la comisión de red"
  - "Inspeccionar los postings y el ConversionDetail"
expected_result:
  - "Postings: BTC Wallet -0.01250000 BTC; EQUITY:FX_TRADING:BTC +0.01200000 BTC; EXPENSE:BTC +0.00050000 BTC (Fees, tipo de comisión NETWORK); EQUITY:FX_TRADING:USDT -600.000000 USDT; USDT Wallet +600.000000 USDT"
  - "Suma BTC = -0.01250000 + 0.01200000 + 0.00050000 = 0; suma USDT = 0"
  - "ConversionDetail: cotizada 50000, efectiva 48000 USDT por BTC (600.000000 / 0.01250000), comisiones por tipo: NETWORK 0.00050000 BTC"
  - "Saldos: BTC Wallet 0.00000000 BTC, USDT Wallet 700.000000 USDT"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-CONVERSION-002 — Conversión de cripto a cripto con comisión de red pagada en el activo de origen

## Intención

Las comisiones pueden cobrarse en el activo de origen; son gastos en esa moneda y nunca se compensan silenciosamente contra la tasa.

## Escenario

```gherkin
Dado que "BTC Wallet" tiene 0.01250000 BTC
Cuando el usuario convierte 0.01200000 BTC a USDT a 50000 USDT por BTC pagando una comisión de red de 0.00050000 BTC
Entonces "USDT Wallet" recibe 600.000000 USDT
  Y se registran 0.00050000 BTC como gasto de Fees en BTC
  Y el asiento cuadra por separado en BTC y en USDT
```
