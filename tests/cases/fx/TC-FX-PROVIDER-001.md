---
id: TC-FX-PROVIDER-001
title: "El provider principal registra la mediana de paralelo.bo como tasa PARALLEL USD/BOB y USDT/BOB"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Providers automáticos de tasa paralela y oficial"
scenario: "Muestra del provider principal"
requirement_status: confirmed
fr: ["FR-FX-009"]
nfr: []
invariants: ["INV-001","INV-011"]
priority: critical
type: integration
level: contract
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/infrastructure/providers/providers.contract.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fx","provider","paralelo-bo","contract-test"]
error_code: null
preconditions:
  - "Servidor HTTP local que sirve el fixture grabado paralelo-bo/rate.ok.json (sin red)"
  - "FixedClock en 2026-10-02T09:00:00Z"
  - "Workspace con BOB, USD y USDT habilitadas"
input: {"fixture": "paralelo-bo/rate.ok.json", "http_status": 200, "headers": {"Cache-Control": "public, max-age=60", "Ratelimit-Limit": "60"}}
steps:
  - "Ejecutar ParaleloBoProvider.fetchLatest() contra el fixture"
  - "Ejecutar PollMarketRates con ese adapter"
expected_result:
  - "Muestras: USD/BOB = \"12.02\" y USDT/BOB = \"12.02\", rateType PARALLEL, provider PARALELO_BO, asOf 2026-10-02T08:53:07.532Z, fetchedAt 2026-10-02T09:00:00Z"
  - "source = PROVIDER en ambas tasas registradas"
  - "rawPayload conserva el texto exacto del fixture (incluye buy 12.12, sell 11.92, spreadPct -1.6972, sourceCount 4)"
  - "buy y sell no alteran el valor de la tasa PARALLEL (se registran aparte como PARALLEL_BUY/PARALLEL_SELL, TC-FX-PROVIDER-016)"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-PROVIDER-001 — El provider principal registra la mediana de paralelo.bo como tasa PARALLEL USD/BOB y USDT/BOB

## Intención

Fija el mapeo del ACL de paralelo.bo: qué campo es la tasa `PARALLEL` (mediana), qué pares se derivan y qué se conserva como evidencia cruda. Desde la decisión del owner del 2026-10-03 la compra y la venta se registran además como tipos propios (TC-FX-PROVIDER-016).

## Escenario

```gherkin
Dado el fixture grabado de paralelo.bo con median 12.02 y timestamp 2026-10-02T08:53:07.532Z
Cuando el job consulta el provider principal
Entonces se registran USD/BOB y USDT/BOB PARALLEL 12.02 con provider paralelo.bo
  Y compra 12.12 y venta 11.92 quedan en la respuesta cruda sin alterar la mediana
```

## Notas

- Fixture `paralelo-bo/rate.ok.json` (texto exacto verificado en vivo el 2026-10-02):

```json
{"timestamp":"2026-10-02T08:53:07.532Z","buy":12.12,"sell":11.92,"median":12.02,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}
```

- Contract test sin red; el smoke en vivo (no bloqueante) valida que la API real siga cumpliendo el mismo JSON Schema.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
