---
id: TC-FX-PROVIDER-021
title: "El EDITOR fija la lista de pares y el cambio queda auditado con las listas anterior y nueva"
spec: fx/market-rate-providers
related_specs: ["audit/audit-trail"]
requirement: "Pares de tasa configurados por workspace"
scenario: "El EDITOR agrega ETH"
requirement_status: provisional
fr: ["FR-FX-009", "FR-AUDIT-001"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "rate-pairs", "audit"]
error_code: null
preconditions:
  - "EDITOR autenticado; ETH habilitada; lista por defecto USD/BOB, USDT/BOB y BTC/USDT"
input: {"mode": "CUSTOM", "pairs": ["USD/BOB", "USDT/BOB", "BTC/USDT", "ETH/USDT"]}
steps:
  - "GET W/fx-rate-pairs y guardar el ETag"
  - "PUT W/fx-rate-pairs con If-Match y la lista de cuatro pares"
  - "Consultar la auditoría"
expected_result:
  - "200 con mode CUSTOM y los cuatro pares"
  - "La auditoría registra actor, instante y las listas anterior y nueva en la misma unidad de trabajo"
  - "Un segundo PUT con el ETag viejo responde 412"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-021 — El EDITOR fija la lista de pares y el cambio queda auditado con las listas anterior y nueva

## Intención

D230: OWNER y EDITOR configuran con auditoría; D250: sin máquina de estados.

## Escenario

```gherkin
Dado el EDITOR con ETH habilitada
Cuando fija la lista con ETH/USDT
Entonces la lista queda guardada
  Y la auditoría registra el cambio
```

## Notas

