---
id: TC-FX-PROVIDER-033
title: "La valoración de un par MARKET usa el respaldo cuando el principal supera 60 minutos de antigüedad"
spec: fx/market-rate-providers
related_specs: []
requirement: "Selección de la tasa de valoración con fallback entre providers"
scenario: "Precio cripto del respaldo"
requirement_status: confirmed
fr: ["FR-FX-010", "FR-FX-006"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/crypto-valuation.test.ts
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "crypto", "staleness", "fallback"]
error_code: null
preconditions:
  - "BTC/USDT MARKET del principal 65000.00 con vigencia 12:50Z; del respaldo 65100.00 con vigencia 13:58Z"
input: {"amount": "0.01000000", "at": "2026-10-13T14:00:00Z"}
steps:
  - "Valorar 0.01000000 BTC en USDT con ValuationRateSelector"
expected_result:
  - "Resultado 651.000000 USDT con la tasa 65100.00 del respaldo y nivel FALLBACK"
  - "Se informan provider, vigencia y antigüedad de 2 minutos"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-033 — La valoración de un par MARKET usa el respaldo cuando el principal supera 60 minutos de antigüedad

## Intención

D228: obsolescencia de 60 min también para MARKET; los scenarios de PARALLEL de Phase 1 siguen como regresión.

## Escenario

```gherkin
Dado el principal con 70 minutos de antigüedad
Cuando se valoran 0.01000000 BTC
Entonces se usa el respaldo
```

## Notas

