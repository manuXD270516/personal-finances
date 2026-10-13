---
id: TC-FX-RATE-007
title: "Bitcoin se valora en BOB con la tasa cruzada por USDT del par configurado"
spec: fx/market-rates
related_specs: []
requirement: "Tasas cruzadas por moneda pivote solo para valoración"
scenario: "Bitcoin a BOB vía USDT"
requirement_status: provisional
fr: ["FR-FX-005", "FR-FX-006"]
nfr: []
invariants: ["INV-001", "INV-002"]
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "cross-rate", "pivot", "crypto"]
error_code: null
preconditions:
  - "BTC/USDT configurado; BTC/USDT MARKET 65000.00 y USDT/BOB PARALLEL 12.02; sin BTC/BOB"
input: {"amount": "0.01500000", "currency": "BTC", "target": "BOB"}
steps:
  - "Valorar con RateResolver"
expected_result:
  - "Tasa cruzada 781300.00 y resultado 11719.50 BOB, redondeado HALF_EVEN una sola vez"
  - "Componentes BTC/USDT MARKET y USDT/BOB PARALLEL; valor marcado aproximado"
  - "Una conversión real BTC→BOB no usa la cruzada como referencia"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-RATE-007 — Bitcoin se valora en BOB con la tasa cruzada por USDT del par configurado

## Intención

D227: pivote USDT para cripto; antes el pivote por defecto era USD y no hay BTC/USD automático.

## Escenario

```gherkin
Dado BTC/USDT 65000.00 y USDT/BOB 12.02
Cuando se valoran 0.01500000 BTC en BOB
Entonces el resultado es 11719.50 BOB aproximado
```

## Notas

- Regresión: el scenario USDT a BOB vía USD sigue igual.
