---
id: TC-FX-PROVIDER-026
title: "El adapter cripto principal traduce la respuesta grabada a tasas MARKET exactas contra USDT"
spec: fx/market-rate-providers
related_specs: []
requirement: "Precios de mercado de criptomonedas desde providers de exchange"
scenario: "Muestra del provider cripto principal"
requirement_status: confirmed
fr: ["FR-FX-009"]
nfr: ["NFR-DATA-001", "NFR-COMP-007"]
invariants: ["INV-001"]
priority: critical
type: integration
level: contract
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 5
tags: ["fx", "crypto", "adapter", "contract", "no-network"]
error_code: null
preconditions:
  - "Descriptor de CRYPTO_BINANCE VERIFIED tras la lectura directa de la tarea 1.5 (ADR-0029)"
  - "Respuesta grabada de GET data-api.binance.vision/api/v3/ticker/24hr?type=MINI servida por un servidor HTTP local (sin red)"
input: {"pair": "BTC/USDT", "price": "65000.01000000", "asOf": "2026-10-13T14:00:00.000Z"}
steps:
  - "Ejecutar fetchLatest del adapter contra la respuesta grabada"
  - "Ingerir la muestra en W1 con BTC/USDT configurado"
expected_result:
  - "Muestra BTC/USDT MARKET con valor exacto \"65000.01000000\" y vigencia 2026-10-13T14:00:00.000Z"
  - "W1 registra la tasa con origen proveedor y el id del provider"
  - "Ningún valor pasa por number (lectura lossless)"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-PROVIDER-026 — El adapter cripto principal traduce la respuesta grabada a tasas MARKET exactas contra USDT

## Intención

Contrato del ACL del provider cripto principal (D225, D226): sin red en CI y con lectura exacta.

## Escenario

```gherkin
Dado la respuesta grabada del provider cripto principal
Cuando el adapter la lee
Entonces registra BTC/USDT MARKET 65000.01000000 exacto
```

## Notas

- Los fixtures se graban tras la verificación de términos (tarea 1.1), con el texto exacto y sin datos de usuario.
- Pendiente (2026-10-13): provider principal `CRYPTO_BINANCE` (D251, ADR-0029 propuesto). Mapeo: `lastPrice` → valor y `closeTime` → vigencia. Falta el adapter (tarea 4.1) y su fixture, que se graba en la tarea 1.5. El flujo de ingesta MARKET exacto con un doble en memoria ya está cubierto en `packages/contexts/fx/src/application/crypto-rate-providers.test.ts`.
