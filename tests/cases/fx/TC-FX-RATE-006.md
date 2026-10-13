---
id: TC-FX-RATE-006
title: "El usuario registra un precio manual de bitcoin con tipo MARKET"
spec: fx/market-rates
related_specs: []
requirement: "Registro manual de tasas de referencia"
scenario: "Precio manual de bitcoin"
requirement_status: confirmed
fr: ["FR-FX-002"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
  - apps/api/test/api/fx-rate-pairs.api.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "market", "manual"]
error_code: null
preconditions:
  - "EDITOR autenticado; BTC habilitada"
input: {"base": "BTC", "quote": "USDT", "value": "64990.50", "rateType": "MARKET", "asOf": "2026-10-13T10:00:00-04:00"}
steps:
  - "POST W/fx-rates con tipo MARKET"
  - "Consultar la tasa por id"
expected_result:
  - "201 con origen manual, tipo MARKET y valor exacto \"64990.50\""
  - "El evento fx.RateRecorded.v1 lleva rateType MARKET y valida contra su schema"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-RATE-006 — El usuario registra un precio manual de bitcoin con tipo MARKET

## Intención

D226: MARKET es un tipo propio; el core debe funcionar sin providers (FR-FX-015), así que el usuario puede registrarlo a mano.

## Escenario

```gherkin
Dado el EDITOR
Cuando registra BTC/USDT 64990.50 MARKET
Entonces la tasa queda con tipo MARKET
```

## Notas

