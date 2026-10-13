---
id: TC-FX-PROVIDER-031
title: "El relleno diario agrega los cierres anteriores cuando un movimiento con fecha pasada adelanta la primera fecha con saldo"
spec: fx/market-rate-providers
related_specs: []
requirement: "Histórico diario de precios cripto desde la primera fecha con saldo"
scenario: "Movimiento con fecha anterior"
requirement_status: confirmed
fr: ["FR-FX-013"]
nfr: []
invariants: ["INV-011"]
priority: medium
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
  - packages/contexts/fx/test/integration/crypto-rates.int.test.ts
  - packages/contexts/ledger/test/integration/pg-ledger.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "crypto", "gap-fill"]
error_code: null
preconditions:
  - "Estado final de TC-FX-PROVIDER-030"
input: {"backdatedMovement": "2026-03-01"}
steps:
  - "Registrar un movimiento en BTC con fecha 2026-03-01"
  - "Ejecutar FillCryptoGaps"
expected_result:
  - "Se registran 9 cierres, del 2026-03-01 al 2026-03-09"
  - "Los 217 cierres previos no cambian"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-031 — El relleno diario agrega los cierres anteriores cuando un movimiento con fecha pasada adelanta la primera fecha con saldo

## Intención

"Completado a diario" (D229) incluye los días que aparecen hacia atrás.

## Escenario

```gherkin
Dado el histórico desde el 2026-03-10
Cuando se registra un movimiento del 2026-03-01 y corre el relleno
Entonces se agregan 9 cierres
```

## Notas

