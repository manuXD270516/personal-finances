---
id: TC-FX-PROVIDER-027
title: "El adapter cripto de respaldo es independiente del principal y produce tasas MARKET con su propio provider"
spec: fx/market-rate-providers
related_specs: []
requirement: "Precios de mercado de criptomonedas desde providers de exchange"
scenario: null
requirement_status: confirmed
fr: ["FR-FX-009", "FR-FX-010"]
nfr: ["NFR-COMP-007"]
invariants: []
priority: high
type: integration
level: contract
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 5
tags: ["fx", "crypto", "adapter", "fallback", "no-network"]
error_code: null
preconditions:
  - "Descriptor de CRYPTO_BYBIT VERIFIED tras la lectura directa de la tarea 1.5 (ADR-0029)"
  - "Respuesta grabada de GET api.bybit.com/v5/market/tickers?category=spot servida localmente"
input: {"pair": "BTC/USDT"}
steps:
  - "Ejecutar fetchLatest del adapter de respaldo"
  - "Simular falla del principal y ejecutar un ciclo"
expected_result:
  - "Muestras MARKET con el id del provider de respaldo"
  - "El respaldo es de otro operador que el principal (descriptor)"
  - "La falla del principal no impide registrar las muestras del respaldo"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-027 — El adapter cripto de respaldo es independiente del principal y produce tasas MARKET con su propio provider

## Intención

D225 exige un respaldo independiente para que las fallas no estén correlacionadas.

## Escenario

```gherkin
Dado el principal caído
Cuando corre un ciclo
Entonces se registran las tasas MARKET del respaldo
```

## Notas
- Pendiente (2026-10-13): respaldo `CRYPTO_BYBIT`, otro operador que `CRYPTO_BINANCE` (D251, ADR-0029 propuesto). Mapeo: `lastPrice` → valor y `time` → vigencia. Falta el adapter (tarea 4.2) y su fixture, que se graba en la tarea 1.5. El fallback entre providers cripto ya se prueba con dobles (TC-FX-PROVIDER-033).
