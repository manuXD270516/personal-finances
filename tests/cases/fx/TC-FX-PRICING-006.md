---
id: TC-FX-PRICING-006
title: "La conversión guarda la versión exacta de la tasa de referencia y no cambia si luego se reemplaza"
spec: fx/conversion-pricing
related_specs: ["fx/market-rates","transactions/conversions"]
requirement: "Registro de la tasa de referencia usada"
scenario: "Reemplazo posterior de la referencia"
requirement_status: confirmed
fr: ["FR-FX-008","FR-FX-003"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011","INV-012"]
priority: critical
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/application/fx.service.test.ts
  - packages/contexts/transactions/src/application/conversions.service.test.ts
  - apps/api/test/api/fx-conversions.api.test.ts
status: automated
regression_suite: true
phase: 1
tags: ["fx","reference-rate","history"]
error_code: null
preconditions:
  - "Preferencia USDT/BOB = P2P"
  - "R2 USDT/BOB P2P = 6.95 vigente 2026-09-29"
input: {"conversion":{"source":"100.000000 USDT","target":"685.00 BOB","quoted":"6.90","fee":"5.00 BOB","executedAt":"2026-09-30T14:42:00-04:00"},"later_supersede":{"rateId":"R2","value":"6.97","reason":"corrección"}}
steps:
  - "Registrar la conversión sin referencia explícita"
  - "Reemplazar R2 por R3 = 6.97"
  - "Leer la conversión"
expected_result:
  - "La conversión queda vinculada a R2 (id, valor 6.95, tipo P2P, fuente)"
  - "Tras el reemplazo sigue mostrando R2 = 6.95 y spread 0.719424460431654676 %"
created: 2026-10-02
updated: 2026-10-03
---

# TC-FX-PRICING-006 — La conversión guarda la versión exacta de la tasa de referencia y no cambia si luego se reemplaza

## Intención

FR-FX-008: la explicación del costo de una conversión no puede cambiar retroactivamente.

## Escenario

```gherkin
Dada la tasa P2P R2 = 6.95
Cuando registro una conversión USDT→BOB el 2026-09-30 sin indicar referencia
Entonces queda vinculada a R2
Cuando R2 se reemplaza por 6.97
Entonces la conversión sigue mostrando la referencia 6.95
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
