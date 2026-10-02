---
id: TC-LEDGER-MONEY-004
title: "Propiedad: el redondeo es determinista, idempotente, simétrico y acotado"
spec: ledger/journal-posting
related_specs: []
requirement: "Redondeo y distribución deterministas"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-006]
nfr: []
invariants: [INV-020, INV-001]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["fast-check", "rounding"]
error_code: null
preconditions: ["Arbitraries: arbCurrency(), arbDecimalString(escala de hasta 18)"]
input:
  numRuns_pr: 100
  numRuns_nightly: 10000
steps: ["Para x y moneda c generados, calcular r = round(x, c)"]
expected_result:
  - "round(r, c) = r (idempotente)"
  - "scale(r) <= c.scale"
  - "|r - x| <= 0.5 * 10^-c.scale"
  - "round(-x, c) = -round(x, c)"
  - "La misma entrada siempre produce la misma salida (sin dependencia del entorno ni del locale)"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-MONEY-004 — Propiedad: el redondeo es determinista, idempotente, simétrico y acotado

## Intención

INV-020: el redondeo debe ser determinista para que los reportes, las divisiones (splits) y las cuotas sean reproducibles entre máquinas y versiones.

## Escenario

```gherkin
Dado cualquier decimal x y cualquier moneda c
Cuando x se redondea a la escala de c
Entonces redondear nuevamente el resultado no lo cambia
  Y la diferencia con x es como máximo media unidad menor
```
