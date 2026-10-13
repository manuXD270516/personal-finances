---
id: TC-FX-USERCONV-001
title: "Cada conversión posteada queda como una observación USER_CONVERSION idempotente, también las anteriores al cambio"
spec: fx/market-rates
related_specs: ["platform/event-delivery"]
requirement: "Observación de tasa por cada conversión propia"
scenario: "Venta de USDT observada"
requirement_status: confirmed
fr: ["FR-FX-011", "FR-FX-003"]
nfr: ["NFR-REL-007"]
invariants: ["INV-011"]
priority: high
type: integration
level: database-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/conversion-costs.api.test.ts
  - packages/contexts/fx/src/application/user-conversion-observations.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["fx", "user-conversion", "observation", "idempotency"]
error_code: null
preconditions:
  - "Consumidor fx.user-conversion-observations registrado"
  - "12 conversiones posteadas antes del cambio"
input: {"sell": "100.000000 USDT", "received": "1190.00 BOB", "executedAt": "2026-10-05T10:00:00-04:00"}
steps:
  - "Postear la venta y entregar ConversionRecorded.v1"
  - "Entregar el mismo evento otra vez y otro evento con el mismo transactionId y revisión"
  - "Ejecutar la carga inicial dos veces"
expected_result:
  - "Observación USDT/BOB origen USER_CONVERSION, valor 11.900000000000000000, vigencia 2026-10-05T10:00:00-04:00 y referencia a la conversión"
  - "Las reentregas no crean otra observación (inbox e índice por conversión y revisión)"
  - "La carga inicial registra 12 observaciones y la segunda ninguna"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-USERCONV-001 — Cada conversión posteada queda como una observación USER_CONVERSION idempotente, también las anteriores al cambio

## Intención

D231: cierra D26 registrando la tasa efectiva de cada conversión.

## Escenario

```gherkin
Dado una venta de 100.000000 USDT por 1190.00 BOB
Cuando se procesa su evento dos veces
Entonces hay una sola observación de 11.90
```

## Notas

- Cubre el scenario "Conversión anterior a este cambio".
