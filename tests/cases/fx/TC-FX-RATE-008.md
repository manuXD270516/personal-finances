---
id: TC-FX-RATE-008
title: "Un par cripto sin preferencia se valora con el tipo MARKET"
spec: fx/market-rates
related_specs: []
requirement: "Tipo de tasa preferido por par para valoración"
scenario: "Par cripto sin preferencia usa el precio de mercado"
requirement_status: confirmed
fr: ["FR-FX-006"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/rate-pairs.test.ts
  - packages/contexts/fx/src/domain/crypto-valuation.test.ts
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "preference", "market"]
error_code: null
preconditions:
  - "BTC/USDT sin preferencia con MARKET 65000.00 del 2026-10-13T14:00:00Z"
input: {"amount": "0.01000000", "at": "2026-10-13T14:05:00Z"}
steps:
  - "Valorar 0.01000000 BTC en USDT sin tipo pedido"
expected_result:
  - "Resultado 650.000000 USDT con la tasa MARKET 65000.00 informada"
  - "USD/BOB sin preferencia sigue usando PARALLEL (regresión)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-RATE-008 — Un par cripto sin preferencia se valora con el tipo MARKET

## Intención

Sin este default, los pares cripto buscarían PARALLEL y quedarían sin tasa.

## Escenario

```gherkin
Dado BTC/USDT sin preferencia
Cuando se valoran 0.01000000 BTC
Entonces se usa MARKET
```

## Notas

