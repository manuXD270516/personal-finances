---
id: TC-FX-PROVIDER-030
title: "El backfill cripto registra cierres diarios desde la primera fecha con saldo hasta ayer y es idempotente"
spec: fx/market-rate-providers
related_specs: ["ledger/balances"]
requirement: "Histórico diario de precios cripto desde la primera fecha con saldo"
scenario: "Backfill desde la primera fecha con saldo"
requirement_status: confirmed
fr: ["FR-FX-013", "FR-REPORTING-006"]
nfr: []
invariants: ["INV-011"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/crypto-rate-providers.test.ts
  - packages/contexts/fx/test/integration/crypto-rates.int.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "crypto", "backfill", "idempotency"]
error_code: null
preconditions:
  - "Hoy es 2026-10-13 (FixedClock)"
  - "W1 con BTC/USDT configurado y primer movimiento en BTC el 2026-03-10"
  - "Caché de histórico con cierres diarios simulados, entre ellos 82000.00 el 2026-03-31"
input: {"from": "2026-03-10", "to": "2026-10-12"}
steps:
  - "Ejecutar BackfillCryptoHistory para W1"
  - "Ejecutarlo otra vez"
expected_result:
  - "Se registran 217 tasas diarias BTC/USDT MARKET, del 2026-03-10 al 2026-10-12"
  - "El cierre del 2026-03-31 vale 82000.00 con vigencia 2026-03-31T23:59:59Z"
  - "El 2026-10-13 no se registra"
  - "La segunda ejecución no registra nada"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-030 — El backfill cripto registra cierres diarios desde la primera fecha con saldo hasta ayer y es idempotente

## Intención

D229: la serie de patrimonio y los snapshots necesitan tasa a cada fin de mes desde que existe saldo.

## Escenario

```gherkin
Dado el primer movimiento en BTC el 2026-03-10
Cuando corre el backfill el 2026-10-13
Entonces hay 217 cierres diarios
  Y repetirlo no agrega nada
```

## Notas

- Incluye el scenario "Recarga idempotente".
