---
id: TC-TRANSACTIONS-CONVERSION-001
title: "La conversión de USDT a BOB con comisión registra patas balanceadas por moneda"
spec: transactions/conversions
related_specs: ["fx/conversion-pricing", "ledger/journal-posting"]
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
tags: ["conversion", "multi-currency", "crypto", "fees"]
error_code: null
preconditions:
  - "USDT Wallet (ASSET, USDT) con saldo 100.000000 USDT"
  - "Bank BOB (ASSET, BOB) con saldo 0.00 BOB"
  - "Existe la categoría \"Fees\" (de sistema)"
input:
  sell: "100.000000 USDT"
  quoted_rate: "6.90 BOB por USDT"
  gross_bob: "690.00"
  fee: "5.00 BOB"
  received: "685.00 BOB"
  date: "2026-03-10"
  provider: "P2P Exchange Demo"
steps:
  - "Registrar la conversión"
  - "Inspeccionar el asiento y el ConversionDetail"
expected_result:
  - "Un JournalEntry con postings: USDT Wallet -100.000000 USDT; EQUITY:FX_TRADING:USDT +100.000000 USDT; EQUITY:FX_TRADING:BOB -690.00 BOB; Bank BOB +685.00 BOB; EXPENSE:BOB +5.00 BOB (categoría de división Fees)"
  - "Suma USDT = 0.000000; suma BOB = -690.00 + 685.00 + 5.00 = 0.00"
  - "ConversionDetail almacena de forma inmutable la tasa cotizada 6.90, la tasa efectiva 6.85 BOB por USDT (685.00 / 100.000000), la comisión 5.00 BOB, el proveedor y la marca de tiempo"
  - "Saldos: USDT Wallet 0.000000 USDT, Bank BOB 685.00 BOB"
created: 2026-10-01
updated: 2026-10-01
---

# TC-TRANSACTIONS-CONVERSION-001 — La conversión de USDT a BOB con comisión registra patas balanceadas por moneda

## Intención

Ejemplo multimoneda canónico de ARCHITECTURE §4.2; es el caso de uso diario del propietario en la Fase 1.

## Escenario

```gherkin
Dado que "USDT Wallet" tiene 100.000000 USDT y "Bank BOB" tiene 0.00 BOB
Cuando el usuario convierte 100.000000 USDT a BOB a una tasa cotizada de 6.90 con una comisión de 5.00 BOB
Entonces "Bank BOB" recibe 685.00 BOB
  Y se registran 5.00 BOB como gasto de Fees
  Y el asiento cuadra por separado en USDT y en BOB
  Y la tasa efectiva es 6.85 BOB por USDT
```
