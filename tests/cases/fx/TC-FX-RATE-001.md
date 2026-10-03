---
id: TC-FX-RATE-001
title: "Registrar manualmente una tasa P2P de USDT/BOB conserva valor, tipo, fuente e instante exactos"
spec: fx/market-rates
related_specs: []
requirement: "Registro manual de tasas de referencia"
scenario: "Registrar la tasa P2P de USDT"
requirement_status: confirmed
fr: ["FR-FX-002"]
nfr: ["NFR-DATA-001"]
invariants: ["INV-001","INV-011"]
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/exchange-rate.test.ts
  - packages/contexts/fx/src/application/fx.service.test.ts
  - packages/contexts/fx/test/integration/pg-fx.int.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fx","rates","manual"]
error_code: null
preconditions:
  - "Usuario con rol EDITOR en el workspace"
  - "Monedas USDT y BOB habilitadas"
input: {"base":"USDT","quote":"BOB","value":"6.95","rateType":"P2P","asOf":"2026-09-29T15:00:00-04:00","sourceLabel":"Mediana Binance P2P","second_value":"6.965432109876543210"}
steps:
  - "Registrar la tasa USDT/BOB 6.95 P2P"
  - "Leer la tasa por su identificador"
  - "Registrar USD/BOB 6.965432109876543210 PARALLEL y leerla"
expected_result:
  - "La tasa tiene identificador propio, origen MANUAL y valor exacto \"6.95\""
  - "Par, tipo, fuente e instante coinciden con lo registrado"
  - "El valor de 18 decimales se lee sin pérdida"
  - "Se emite fx.RateRecorded.v1 en el outbox"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-RATE-001 — Registrar manualmente una tasa P2P de USDT/BOB conserva valor, tipo, fuente e instante exactos

## Intención

Las tasas manuales son la única fuente de valoración en Phase 1; deben guardarse exactas (sin float) y con su procedencia.

## Escenario

```gherkin
Dado que soy EDITOR del workspace
Cuando registro USDT/BOB = 6.95 tipo P2P vigente desde 2026-09-29 15:00 La Paz con fuente "Mediana Binance P2P"
Entonces la tasa queda registrada con origen manual
  Y al leerla obtengo exactamente "6.95", P2P, la fuente y el instante
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
