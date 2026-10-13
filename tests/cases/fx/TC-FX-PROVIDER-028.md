---
id: TC-FX-PROVIDER-028
title: "Respuestas cripto inválidas o con cambio de formato no registran tasas y cuentan como falla"
spec: fx/market-rate-providers
related_specs: []
requirement: "Precios de mercado de criptomonedas desde providers de exchange"
scenario: "Precio con más de 18 decimales"
requirement_status: confirmed
fr: ["FR-FX-009"]
nfr: ["NFR-DATA-001"]
invariants: []
priority: high
type: integration
level: contract
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 5
tags: ["fx", "crypto", "adapter", "payload"]
error_code: "PROVIDER_PAYLOAD_INVALID"
preconditions:
  - "Variantes de la respuesta grabada: precio con 19 decimales, precio nulo, precio cero, campo renombrado, JSON truncado"
input: {"price": "2450.1234567890123456789"}
steps:
  - "Ejecutar fetchLatest con cada variante"
expected_result:
  - "19 decimales, nulo, cero y truncado: PROVIDER_PAYLOAD_INVALID sin tasas"
  - "Campo renombrado: PROVIDER_SCHEMA_CHANGED sin tasas"
  - "El estado del provider cuenta cada intento como falla"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-028 — Respuestas cripto inválidas o con cambio de formato no registran tasas y cuentan como falla

## Intención

Mismas garantías de lectura que los providers de Phase 1, aplicadas a cripto.

## Escenario

```gherkin
Dado un precio con 19 decimales
Cuando el adapter lo lee
Entonces no registra tasa y marca PROVIDER_PAYLOAD_INVALID
```

## Notas
- Pendiente (2026-10-13): las variantes de la respuesta grabada del provider (JSON truncado, campo renombrado) dependen de los adapters `CRYPTO_BINANCE` y `CRYPTO_BYBIT` (tareas 4.1 y 4.2) y de sus fixtures (tarea 1.5). Ambos publican el precio como texto JSON; también se cubre un `retCode` distinto de 0 en Bybit. La validación del precio (19 decimales, nulo, cero) y su registro como falla `PROVIDER_PAYLOAD_INVALID` ya están cubiertos con el doble en `crypto-rate-providers.test.ts`.
