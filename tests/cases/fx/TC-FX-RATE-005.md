---
id: TC-FX-RATE-005
title: "Un par sin preferencia de tipo se valora con la tasa PARALLEL, no con la más reciente de cualquier tipo"
spec: fx/market-rates
related_specs: ["reporting/dashboard"]
requirement: "Tipo de tasa preferido por par para valoración"
scenario: "Par sin preferencia usa el tipo paralelo"
requirement_status: confirmed
fr: ["FR-FX-006"]
nfr: []
invariants: ["INV-020"]
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/rate-resolver.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fx","valuation","preferences"]
error_code: null
preconditions:
  - "USD/BOB sin preferencia de tipo (la preferencia sembrada se eliminó)"
  - "USD/BOB PARALLEL 9.80 del 2026-09-30 y OFFICIAL 6.96 del 2026-10-01"
input: {"amount":"100.00 USD","asOf":"2026-10-01"}
steps:
  - "Valorar 100.00 USD en BOB al 2026-10-01"
expected_result:
  - "Resultado 980.00 BOB con tasa PARALLEL 9.80 del 2026-09-30 y su fuente"
  - "La tasa OFFICIAL 6.96, aunque más reciente, no se usa"
created: 2026-10-05
updated: 2026-10-05
---

# TC-FX-RATE-005 — Un par sin preferencia de tipo se valora con la tasa PARALLEL

## Intención

Decisión del owner D48 (docs/31, 2026-10-05): el tipo por defecto de un par sin preferencia es `PARALLEL`, el mismo default de los pares con BOB; reemplaza "la más reciente de cualquier tipo".

## Escenario

```gherkin
Dado USD/BOB sin preferencia de tipo, PARALLEL 9.80 del 2026-09-30 y OFFICIAL 6.96 del 2026-10-01
Cuando valoro 100.00 USD en BOB al 2026-10-01
Entonces obtengo 980.00 BOB indicando la tasa PARALLEL 9.80 usada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- Lo automatiza add-manual-conversions junto con el ajuste del `RateResolver` (D48).
