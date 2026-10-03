---
id: TC-TRANSACTIONS-CONVERSION-003
title: "Convertir entre cuentas de la misma moneda se rechaza con CONVERSION_SAME_CURRENCY"
spec: transactions/conversions
related_specs: ["transactions/transfers"]
requirement: "Conversión exige monedas distintas"
scenario: "Misma moneda en origen y destino"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-020","FR-TRANSACTIONS-004"]
nfr: []
invariants: ["INV-002","INV-006"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/domain/conversion.test.ts
  - packages/contexts/transactions/src/application/conversions.service.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["conversion","validation"]
error_code: "CONVERSION_SAME_CURRENCY"
preconditions:
  - "\"Banco BOB\" y \"Caja BOB\" (ASSET, BOB)"
  - "\"Wallet USDT\" (ASSET, USDT)"
input: {"same_currency":{"source":"Banco BOB 100.00 BOB","target":"Caja BOB 100.00 BOB"},"mismatch":{"source":"Wallet USDT","sourceAmount":"100.00 USD"}}
steps:
  - "POST /conversions entre Banco BOB y Caja BOB"
  - "POST /conversions con monto USD desde Wallet USDT"
expected_result:
  - "Primero: 422 CONVERSION_SAME_CURRENCY; sin transacción ni asiento"
  - "Segundo: 422 CURRENCY_MISMATCH"
created: 2026-10-02
updated: 2026-10-03
---

# TC-TRANSACTIONS-CONVERSION-003 — Convertir entre cuentas de la misma moneda se rechaza con CONVERSION_SAME_CURRENCY

## Intención

Una conversión entre la misma moneda es una transferencia; mezclarlas rompe los reportes de FX.

## Escenario

```gherkin
Cuando intento convertir 100.00 BOB de "Banco BOB" a "Caja BOB"
Entonces la operación se rechaza con CONVERSION_SAME_CURRENCY
  Y no se crea ninguna transacción
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
