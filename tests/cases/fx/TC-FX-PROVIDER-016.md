---
id: TC-FX-PROVIDER-016
title: "Compra y venta publicadas se registran como PARALLEL_BUY y PARALLEL_SELL sin cambiar la valoración por defecto"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Compra y venta publicadas como tipos de tasa propios"
scenario: "Compra y venta del provider principal"
requirement_status: confirmed
fr: ["FR-FX-009","FR-FX-011"]
nfr: []
invariants: ["INV-001","INV-011"]
priority: high
type: integration
level: contract
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/infrastructure/providers/providers.contract.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
  - packages/contexts/fx/src/domain/valuation-rate-selector.test.ts
  - packages/contexts/fx/test/integration/providers.int.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","provider","paralelo-bo","dolarapi-bo","buy-sell","contract-test"]
error_code: null
preconditions:
  - "Servidor HTTP local con los fixtures grabados paralelo-bo/rate.ok.json y dolarapi-bo/dolares.ok.json (sin red)"
  - "FixedClock en 2026-10-02T09:00:00Z"
  - "Workspace con BOB, USD y USDT habilitadas"
input: {"paralelo_bo": {"buy": "12.12", "sell": "11.92", "median": "12.02", "timestamp": "2026-10-02T08:53:07.532Z"}, "dolarapi_bo_binance": {"compra": "12.04", "venta": "12.07", "fechaActualizacion": "2026-10-02T08:50:00.000Z"}, "valuation": {"amount": "100.00 USD", "t": "2026-10-02T09:00:00Z"}}
steps:
  - "Ejecutar ParaleloBoProvider.fetchLatest() y DolarApiBoProvider.fetchLatest() contra los fixtures"
  - "Ejecutar PollMarketRates y registrar las muestras en PostgreSQL"
  - "Valorar 100.00 USD sin preferencia, con preferencia PARALLEL y con preferencia PARALLEL_SELL"
expected_result:
  - "paralelo.bo: USD/BOB y USDT/BOB PARALLEL_BUY = 12.12 y PARALLEL_SELL = 11.92 (perspectiva de quien opera), misma vigencia, provider y respuesta cruda que la mediana 12.02"
  - "bo.dolarapi.com (casa binance): PARALLEL_BUY = venta 12.07 y PARALLEL_SELL = compra 12.04; PARALLEL sigue siendo 12.055"
  - "buy/sell nulos o ausentes: solo se registra la mediana; buy/sell presentes pero inválidos (≤ 0, no numéricos): PROVIDER_PAYLOAD_INVALID"
  - "Un ciclo registra 6 tasas (mediana, compra y venta por par) y un fx.RateRecorded.v1 válido por tasa"
  - "Sin preferencia o con preferencia PARALLEL: 1202.00 BOB con la mediana; con preferencia PARALLEL_SELL: 1192.00 BOB, selection PRIMARY"
  - "El CHECK de tipo de tasa (fx.exchange_rate, fx.rate_preference, txn.conversion_detail) admite PARALLEL_BUY y PARALLEL_SELL"
created: 2026-10-03
updated: 2026-10-03
---

# TC-FX-PROVIDER-016 — Compra y venta publicadas se registran como PARALLEL_BUY y PARALLEL_SELL sin cambiar la valoración por defecto

## Intención

Decisión del owner (2026-10-03): la compra y la venta del mercado paralelo son tipos de tasa propios para analizar el spread (FR-FX-011), sin que la valoración por defecto deje de usar la mediana.

## Escenario

```gherkin
Dado paralelo.bo responde buy 12.12, sell 11.92 y median 12.02
Cuando el job consulta el provider principal
Entonces se registran PARALLEL 12.02, PARALLEL_BUY 12.12 y PARALLEL_SELL 11.92 para USD/BOB y USDT/BOB
  Y valorar 100.00 USD con la preferencia PARALLEL sigue dando 1202.00 BOB
```

## Notas

- Perspectiva de quien opera: `PARALLEL_BUY` = lo que paga quien compra la divisa (`buy` de paralelo.bo, `venta` de la casa); `PARALLEL_SELL` = lo que recibe quien la vende (`sell` de paralelo.bo, `compra` de la casa). La casa `oficial` no aporta compra/venta propias.
- Compra/venta solo se usan si se piden explícitamente (tipo pedido o preferencia); nunca entran sin tipo ni en el nivel de manuales de otro tipo.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
