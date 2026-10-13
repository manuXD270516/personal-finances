---
id: TC-FX-PROVIDER-022
title: "La lista de pares rechaza a un VIEWER, monedas no habilitadas y quotes distintas de la base y de USDT"
spec: fx/market-rate-providers
related_specs: ["security/access-control"]
requirement: "Pares de tasa configurados por workspace"
scenario: "VIEWER sin permiso"
requirement_status: provisional
fr: ["FR-FX-009"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "rate-pairs", "authorization", "validation"]
error_code: "INSUFFICIENT_ROLE"
preconditions:
  - "Workspace con moneda base BOB; ETH no habilitada"
input: {}
steps:
  - "PUT W/fx-rate-pairs como VIEWER"
  - "PUT como EDITOR con ETH/USDT"
  - "PUT como EDITOR con BTC/USD"
expected_result:
  - "VIEWER: 403 INSUFFICIENT_ROLE"
  - "ETH/USDT: 422 CURRENCY_NOT_ENABLED"
  - "BTC/USD: 422 VALIDATION_FAILED"
  - "En los tres casos la lista y su versión no cambian"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-022 — La lista de pares rechaza a un VIEWER, monedas no habilitadas y quotes distintas de la base y de USDT

## Intención

Protege la autorización y las reglas de la lista (quote = moneda base o USDT, D227).

## Escenario

```gherkin
Dado un VIEWER
Cuando intenta fijar la lista
Entonces recibe INSUFFICIENT_ROLE
  Y la lista no cambia
```

## Notas

- Cubre también los scenarios "Par con una moneda no habilitada" y "Quote distinta de la moneda base y de USDT".
