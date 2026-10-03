---
id: TC-FX-PROVIDER-009
title: "La tasa manual indicada para una conversión es su referencia y los providers no tocan tasas manuales"
spec: fx/market-rate-providers
related_specs: ["fx/market-rates","fx/conversion-pricing","transactions/conversions"]
requirement: "Las tasas manuales prevalecen para operaciones concretas"
scenario: "Conversión con tasa manual indicada"
requirement_status: confirmed
fr: ["FR-FX-010","FR-FX-008","FR-FX-002"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011","INV-012"]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/valuation-rate-selector.test.ts
  - packages/contexts/fx/src/application/market-rate-providers.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","provider","manual-rate","conversion"]
error_code: null
preconditions:
  - "Cuentas \"Wallet USDT\" (USDT) con 200.000000 USDT y \"Banco BOB\" (BOB)"
  - "USDT/BOB PARALLEL 12.02 de paralelo.bo (asOf 2026-10-02T08:53:07.532Z)"
  - "Tasa manual USD/BOB PARALLEL 12.10 (asOf 2026-10-02T07:00:00Z) registrada antes del ciclo de polling"
input: {"manual_rate": {"pair": "USDT/BOB", "type": "P2P", "value": "11.98", "asOf": "2026-10-02T09:10:00Z"}, "conversion": {"source": "100.000000 USDT", "target": "1198.00 BOB", "executedAt": "2026-10-02T09:12:00Z", "referenceFxRateId": "<id de la tasa manual 11.98>"}}
steps:
  - "Registrar la tasa manual USDT/BOB P2P 11.98"
  - "Registrar la conversión indicando esa tasa como referencia"
  - "Ejecutar un ciclo de polling que registra USD/BOB 12.02 de paralelo.bo"
  - "Leer la tasa manual USD/BOB 12.10"
expected_result:
  - "ConversionDetail.referenceRate = 11.98 con fxRateId de la tasa manual, source MANUAL, rateType P2P"
  - "La tasa 12.02 del provider no figura como referencia de la conversión"
  - "La tasa manual USD/BOB 12.10 sigue con valor 12.10, sin supersededByRateId"
  - "Registrar tasas manuales funciona con providers activos"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-PROVIDER-009 — La tasa manual indicada para una conversión es su referencia y los providers no tocan tasas manuales

## Intención

El usuario sabe a qué tasa operó; un provider automático nunca debe reescribir esa verdad (RISK-003).

## Escenario

```gherkin
Dada la tasa de provider USDT/BOB 12.02
  Y la tasa manual USDT/BOB P2P 11.98 que el usuario indica para su conversión
Cuando registra la conversión de 100.000000 USDT a 1198.00 BOB
Entonces la referencia registrada es la tasa manual 11.98
```

## Notas

- Datos ficticios salvo la tasa del provider. Cubre también el scenario "El provider no toca tasas manuales".
- Fechas fijas con `FixedClock`; instantes en UTC (America/La_Paz = UTC−4). Sin red en CI: providers simulados con fixtures grabados.
