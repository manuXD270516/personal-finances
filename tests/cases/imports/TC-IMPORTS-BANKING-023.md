---
id: TC-IMPORTS-BANKING-023
title: "Un trade spot se propone como conversión con el detalle del exchange"
spec: imports/banking-providers
related_specs: []
requirement: "Trades del exchange como conversiones"
scenario: "Compra de BTC con USDT"
requirement_status: provisional
fr: ["FR-IMPORTS-014", "FR-TRANSACTIONS-020", "FR-TRANSACTIONS-023"]
nfr: []
invariants: ["INV-001", "INV-003", "INV-004"]
priority: high
type: integration
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "banking-providers"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Usuario OWNER autenticado salvo indicación"
  - "Cuentas \"Exchange USDT\" (USDT, escala 6) y \"Exchange BTC\" (BTC, escala 8), activas"
  - "Proveedor simulado FAKE_EXCHANGE habilitado (IMPORTS_PROVIDER_FAKE_ENABLED, entorno test)"
  - "Claves de prueba CONNECTION_CREDENTIALS_* generadas por el test (k1 vigente); credencial de prueba con identificador terminado en a1b2"
  - "Conexión \"Exchange principal\" (FAKE_EXCHANGE) ACTIVE con USDT ⇒ Exchange USDT y BTC ⇒ Exchange BTC"
input: {"trade":{"buy":"0.01500000 BTC","price":"65000.00 USDT/BTC","pay":"975.000000 USDT","fee":"0.00001500 BTC (destino)"}}
steps:
  - "Sincronizar"
  - "Ver la vista previa"
  - "Aprobar"
expected_result:
  - "Conversión 975.000000 USDT ⇒ 0.01498500 BTC netos"
  - "Detalle: cotizada 65000.00, fee PROVIDER 0.00001500 BTC como gasto Fees, instante del exchange"
  - "Asiento: suma cero en USDT y en BTC"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-BANKING-023 — Un trade spot se propone como conversión con el detalle del exchange

## Intención

FR-IMPORTS-014: conversión con ConversionDetail del exchange, sin recalcular.

## Escenario

```gherkin
Dada la compra de 0.01500000 BTC a 65000.00 USDT con fee 0.00001500 BTC
Cuando sincronizo y apruebo
Entonces se crea la conversión de 975.000000 USDT a 0.01498500 BTC netos
  Y el asiento cuadra por moneda
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz). Nunca datos reales del owner.
- Change: `add-banking-providers`.
