---
id: TC-FX-RATE-004
title: "La valoración usa el tipo de tasa preferido del par e informa tasa, tipo, fuente y fecha"
spec: fx/market-rates
related_specs: ["reporting/dashboard"]
requirement: "Tipo de tasa preferido por par para valoración"
scenario: "USD valorado con la tasa oficial"
requirement_status: confirmed
fr: ["FR-FX-006"]
nfr: []
invariants: ["INV-020"]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","valuation","preferences"]
error_code: null
preconditions:
  - "USD/BOB OFFICIAL 6.96 y PARALLEL 9.80, ambas del 2026-09-30"
  - "Preferencia del par USD/BOB = OFFICIAL"
input: {"amount":"100.00 USD","asOf":"2026-09-30","new_preference":"PARALLEL"}
steps:
  - "Valorar 100.00 USD en BOB"
  - "Cambiar la preferencia a PARALLEL"
  - "Valorar nuevamente"
expected_result:
  - "Primera valoración: 696.00 BOB con tasa OFFICIAL 6.96 del 2026-09-30 y su fuente"
  - "Segunda valoración: 980.00 BOB con tasa PARALLEL 9.80"
  - "Ninguna tasa ni transacción cambió"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-RATE-004 — La valoración usa el tipo de tasa preferido del par e informa tasa, tipo, fuente y fecha

## Intención

En Bolivia coexisten tasa oficial y paralela; la elección debe ser explícita y visible, nunca implícita.

## Escenario

```gherkin
Dado USD/BOB OFFICIAL 6.96 y PARALLEL 9.80 y preferencia OFFICIAL
Cuando valoro 100.00 USD en BOB
Entonces obtengo 696.00 BOB indicando la tasa OFFICIAL usada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
