---
id: TC-FX-RATE-002
title: "Se rechazan tasas con valor cero o con la misma moneda como base y quote"
spec: fx/market-rates
related_specs: []
requirement: "Validez de una tasa de cambio"
scenario: "Tasa cero rechazada"
requirement_status: confirmed
fr: ["FR-FX-002"]
nfr: []
invariants: ["INV-032"]
priority: high
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","validation"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "VO Rate del dominio FX"
input: {"invalid":[{"base":"USDT","quote":"BOB","value":"0.00"},{"base":"USDT","quote":"BOB","value":"-6.95"},{"base":"BOB","quote":"BOB","value":"1.00"}]}
steps:
  - "Construir cada tasa inválida"
  - "Intentar registrarla vía el caso de uso"
expected_result:
  - "Cada intento se rechaza con VALIDATION_FAILED"
  - "No se persiste ninguna tasa ni se emite evento"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-RATE-002 — Se rechazan tasas con valor cero o con la misma moneda como base y quote

## Intención

INV-032: una tasa ≤ 0 o un par degenerado produciría valoraciones absurdas o divisiones por cero.

## Escenario

```gherkin
Cuando intento registrar USDT/BOB = 0.00
Entonces la operación se rechaza con VALIDATION_FAILED
  Y no se crea ninguna tasa
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
