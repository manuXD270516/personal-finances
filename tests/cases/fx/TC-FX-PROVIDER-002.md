---
id: TC-FX-PROVIDER-002
title: "El provider de respaldo registra la tasa oficial y la paralela de Binance con punto medio exacto"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Providers automáticos de tasa paralela y oficial"
scenario: "Muestra del provider de respaldo"
requirement_status: confirmed
fr: ["FR-FX-009"]
nfr: []
invariants: ["INV-001","INV-011"]
priority: high
type: integration
level: contract
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/infrastructure/providers/providers.contract.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fx","provider","dolarapi","contract-test"]
error_code: null
preconditions:
  - "Servidor HTTP local que sirve el fixture dolarapi-bo/dolares.ok.json"
  - "FixedClock en 2026-10-02T09:00:00Z"
input: {"fixture": "dolarapi-bo/dolares.ok.json", "http_status": 200}
steps:
  - "Ejecutar DolarApiBoProvider.fetchLatest() contra el fixture"
expected_result:
  - "USD/BOB OFFICIAL = \"12\" (punto medio de compra 12 y venta 12), provider DOLARAPI_BO, asOf 2026-10-01T00:00:00.000Z"
  - "USD/BOB PARALLEL = \"12.055\" y USDT/BOB PARALLEL = \"12.055\" ((12.04 + 12.07) / 2 exacto), provider DOLARAPI_BO, asOf 2026-10-02T08:50:00.000Z"
  - "Ninguna casa distinta de oficial y binance genera tasas"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-PROVIDER-002 — El provider de respaldo registra la tasa oficial y la paralela de Binance con punto medio exacto

## Intención

El respaldo usa otra metodología (punto medio compra/venta de Binance P2P); el cálculo debe ser exacto y la procedencia explícita.

## Escenario

```gherkin
Dado el fixture de bo.dolarapi.com con oficial 12/12 y binance 12.04/12.07
Cuando se consulta el provider de respaldo
Entonces se registra USD/BOB OFFICIAL 12
  Y USD/BOB y USDT/BOB PARALLEL 12.055
```

## Notas

- Fixture `dolarapi-bo/dolares.ok.json` (casas oficial y binance verificadas el 2026-10-02; la `fechaActualizacion` de binance es un valor de fixture):

```json
[{"moneda":"USD","casa":"oficial","nombre":"Oficial","compra":12,"venta":12,"fechaActualizacion":"2026-10-01T00:00:00.000Z"},{"moneda":"USD","casa":"binance","nombre":"Binance","compra":12.04,"venta":12.07,"fechaActualizacion":"2026-10-02T08:50:00.000Z"}]
```

- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
