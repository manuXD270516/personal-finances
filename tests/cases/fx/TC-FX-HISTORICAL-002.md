---
id: TC-FX-HISTORICAL-002
title: "Corregir una tasa crea una versión que la reemplaza, con motivo auditado y sin doble reemplazo"
spec: fx/market-rates
related_specs: ["audit/audit-trail"]
requirement: "Corrección de tasa por reemplazo auditado"
scenario: "Corregir un error de tipeo"
requirement_status: confirmed
fr: ["FR-FX-003"]
nfr: ["NFR-DATA-006","NFR-DATA-007"]
invariants: ["INV-011","INV-029"]
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/exchange-rate.test.ts
  - packages/contexts/fx/src/application/fx.service.test.ts
  - packages/contexts/fx/test/integration/pg-fx.int.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","supersede","audit"]
error_code: "FX_RATE_ALREADY_SUPERSEDED"
preconditions:
  - "R1 USDT/BOB P2P = 9.65 vigente 2026-09-29 registrada por error"
input: {"supersede":{"rateId":"R1","value":"6.95","reason":"error de tipeo"},"second_attempt":{"rateId":"R1","value":"6.94"}}
steps:
  - "Reemplazar R1 por 6.95 con motivo"
  - "Leer R1 y R2"
  - "Leer la auditoría de la tasa"
  - "Intentar reemplazar R1 otra vez"
expected_result:
  - "Se crea R2 = 6.95 con la misma vigencia y supersedesRateId = R1"
  - "R1 sigue legible con 9.65 y supersededByRateId = R2"
  - "La auditoría registra actor, instante y motivo en la misma transacción"
  - "El segundo intento responde 409 FX_RATE_ALREADY_SUPERSEDED"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-HISTORICAL-002 — Corregir una tasa crea una versión que la reemplaza, con motivo auditado y sin doble reemplazo

## Intención

INV-011: corregir sin destruir historia; las conversiones que usaron R1 conservan su referencia.

## Escenario

```gherkin
Dado R1 USDT/BOB = 9.65 del 2026-09-29 registrada por error
Cuando la reemplazo por 6.95 con motivo "error de tipeo"
Entonces existe R2 = 6.95 que reemplaza a R1
  Y R1 sigue consultable con 9.65
  Y la auditoría registra el motivo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
