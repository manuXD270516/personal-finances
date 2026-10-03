---
id: TC-FX-RATE-003
title: "La tasa vigente a una fecha es la última no reemplazada dentro de la ventana de 7 días"
spec: fx/market-rates
related_specs: []
requirement: "Consulta de la tasa vigente a una fecha"
scenario: "Última tasa anterior dentro de la ventana"
requirement_status: confirmed
fr: ["FR-FX-004"]
nfr: []
invariants: ["INV-011"]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/rate-resolver.test.ts
  - packages/contexts/fx/src/application/fx.service.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","as-of","rate-resolver"]
error_code: "FX_RATE_NOT_FOUND"
preconditions:
  - "USDT/BOB P2P 6.93 vigente 2026-09-25"
  - "USDT/BOB P2P 6.95 vigente 2026-09-29 (R2, reemplaza a R1 = 9.65 de la misma fecha)"
input: {"query_1":{"pair":"USDT/BOB","rateType":"P2P","asOf":"2026-09-30T23:59:59-04:00"},"query_2":{"pair":"USDT/BOB","rateType":"P2P","asOf":"2026-10-10T12:00:00-04:00"},"window_days":7}
steps:
  - "Resolver la tasa al 2026-09-30"
  - "Resolver la tasa al 2026-10-10"
expected_result:
  - "Al 2026-09-30 se obtiene R2 = 6.95 con id, fecha 2026-09-29 y fuente (R1 reemplazada no se usa)"
  - "Al 2026-10-10 se obtiene FX_RATE_NOT_FOUND, sin valor aproximado ni 1:1"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-RATE-003 — La tasa vigente a una fecha es la última no reemplazada dentro de la ventana de 7 días

## Intención

FR-FX-004: nunca inventar una tasa; usar la más reciente válida y explícita.

## Escenario

```gherkin
Dado USDT/BOB P2P 6.93 del 2026-09-25 y 6.95 del 2026-09-29
Cuando consulto la tasa P2P al 2026-09-30
Entonces obtengo 6.95 del 2026-09-29
Cuando consulto al 2026-10-10 con ventana de 7 días
Entonces obtengo FX_RATE_NOT_FOUND
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
