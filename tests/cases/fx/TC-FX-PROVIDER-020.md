---
id: TC-FX-PROVIDER-020
title: "La lista de pares por defecto se deriva de las monedas habilitadas: fiat y estables frente a la base y cripto frente a USDT"
spec: fx/market-rate-providers
related_specs: []
requirement: "Pares de tasa configurados por workspace"
scenario: "Lista por defecto"
requirement_status: provisional
fr: ["FR-FX-009"]
nfr: []
invariants: []
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "rate-pairs", "default", "pbt"]
error_code: null
preconditions:
  - "Workspace con moneda base BOB sin lista de pares fijada"
  - "Catálogo: BOB y USD FIAT; USDT CRYPTO estable; BTC y ETH CRYPTO volátiles"
input: {"enabled": ["BOB", "USD", "USDT", "BTC"], "base": "BOB"}
steps:
  - "Derivar la lista por defecto con DefaultRatePairs"
  - "PBT: 500 combinaciones aleatorias de monedas habilitadas, con timeout explícito"
expected_result:
  - "Con BOB, USD, USDT y BTC la lista es USD/BOB, USDT/BOB y BTC/USDT"
  - "Ningún par repite moneda ni tiene la moneda base como base"
  - "Si hay un par contra USDT, USDT/BOB está en la lista"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-020 — La lista de pares por defecto se deriva de las monedas habilitadas: fiat y estables frente a la base y cripto frente a USDT

## Intención

D220 y D227 combinados: la lista por defecto es la base del criterio de 30 días; un par faltante dejaría una moneda del owner sin tasa automática.

## Escenario

```gherkin
Dado un workspace BOB con USD, USDT y BTC habilitadas
Cuando se deriva la lista por defecto
Entonces es USD/BOB, USDT/BOB y BTC/USDT
```

## Notas

- Test-first del DS puro.
