---
id: TC-TRANSACTIONS-CONVERSION-001
title: "La conversión de USDT a BOB con comisión registra patas balanceadas por moneda"
spec: transactions/conversions
related_specs: ["fx/conversion-pricing","ledger/journal-posting"]
requirement: "Conversión registrada como una transacción con patas balanceadas por moneda"
scenario: "Ejemplo canónico USDT a BOB"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-021","FR-TRANSACTIONS-001"]
nfr: ["NFR-DATA-004"]
invariants: ["INV-001","INV-002","INV-004","INV-010","INV-011"]
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/conversion.test.ts
  - packages/contexts/transactions/src/application/conversions.service.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["conversion","multi-currency","crypto","fees"]
error_code: null
preconditions:
  - "Wallet USDT (ASSET, USDT) con saldo 100.000000 USDT"
  - "Banco BOB (ASSET, BOB) con saldo 0.00 BOB"
  - "Existe la categoría \"Fees\" (de sistema)"
  - "Tasa de referencia USDT/BOB P2P 6.95 vigente"
input: {"sell":"100.000000 USDT","quoted_rate":"USDT/BOB 6.90","gross_bob":"690.00","fee":"5.00 BOB PROVIDER","received":"685.00 BOB","date":"2026-09-30","executedAt":"2026-09-30T14:42:00-04:00","provider":"Binance P2P"}
steps:
  - "Registrar la conversión"
  - "Inspeccionar el asiento y el ConversionDetail"
expected_result:
  - "Una transacción CONVERSION con un JournalEntry: Wallet USDT −100.000000 USDT; EQUITY:FX_TRADING:USDT +100.000000 USDT; EQUITY:FX_TRADING:BOB −690.00 BOB; Banco BOB +685.00 BOB; EXPENSE:BOB +5.00 BOB (split categoría Fees)"
  - "Suma USDT = 0.000000; suma BOB = −690.00 + 685.00 + 5.00 = 0.00"
  - "ConversionDetail inmutable: cotizada 6.90, efectiva 6.85, referencia 6.95, spread 0.719424460431654676 %, fee 5.00 BOB, proveedor y marca de tiempo"
  - "Saldos: Wallet USDT 0.000000 USDT, Banco BOB 685.00 BOB"
created: 2026-10-01
updated: 2026-10-03
---

# TC-TRANSACTIONS-CONVERSION-001 — La conversión de USDT a BOB con comisión registra patas balanceadas por moneda

## Intención

Ejemplo multimoneda canónico de ARCHITECTURE §4.2; es el caso de uso diario del propietario en la Fase 1.

## Escenario

```gherkin
Dado que "Wallet USDT" tiene 100.000000 USDT y "Banco BOB" tiene 0.00 BOB
Cuando el usuario convierte 100.000000 USDT a BOB a una tasa cotizada de 6.90 con una comisión de 5.00 BOB
Entonces "Banco BOB" recibe 685.00 BOB
  Y se registran 5.00 BOB como gasto de Fees
  Y el asiento cuadra por separado en USDT y en BOB
  Y la tasa efectiva es 6.85 BOB por USDT
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
