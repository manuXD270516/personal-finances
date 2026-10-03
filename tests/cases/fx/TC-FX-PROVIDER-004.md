---
id: TC-FX-PROVIDER-004
title: "Una muestra con valor ausente o inválido no registra tasas y cuenta como falla del provider"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates"]
requirement: "Lectura exacta de los valores publicados por los providers"
scenario: "Valor ausente"
requirement_status: confirmed
fr: ["FR-FX-009"]
nfr: ["NFR-DATA-001"]
invariants: ["INV-032"]
priority: high
type: integration
level: contract
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/infrastructure/providers/lossless-json-reader.test.ts
  - packages/contexts/fx/src/infrastructure/providers/providers.contract.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fx","provider","validation"]
error_code: "PROVIDER_PAYLOAD_INVALID"
preconditions:
  - "FixedClock en 2026-10-02T09:15:00Z"
  - "Última tasa registrada de paralelo.bo: 12.02 con vigencia 2026-10-02T08:53:07.532Z"
input: {"variants": ["median: null", "median: \"N/A\"", "median: 0", "median: -12.02", "median: 12.0200000000000000001 (19 decimales)"]}
steps:
  - "Servir cada variante como respuesta de paralelo.bo"
  - "Ejecutar PollMarketRates"
expected_result:
  - "Ninguna variante registra tasas"
  - "fx.provider_run registra outcome FAILED con error_code PROVIDER_PAYLOAD_INVALID"
  - "El estado muestra lastError.code = PROVIDER_PAYLOAD_INVALID y consecutiveFailures incrementado"
  - "La última tasa válida 12.02 sigue siendo la del provider"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-PROVIDER-004 — Una muestra con valor ausente o inválido no registra tasas y cuenta como falla del provider

## Intención

Una tasa basura es peor que ninguna: se descarta y se informa, nunca se registra (INV-032: tasa > 0).

## Escenario

```gherkin
Dado paralelo.bo responde median nulo
Cuando el job procesa la muestra
Entonces no se registra ninguna tasa
  Y el estado del provider muestra PROVIDER_PAYLOAD_INVALID
```

## Notas

- Fixture `paralelo-bo/rate.median-null.json`: `{"timestamp":"2026-10-02T09:10:00.000Z","buy":12.12,"sell":11.92,"median":null,"spreadPct":-1.6972,"sourceCount":0,"methodologyVersion":"ec2-backend"}`
- Un cambio de schema (campo `median` renombrado) se prueba aparte y produce `PROVIDER_SCHEMA_CHANGED`.
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
