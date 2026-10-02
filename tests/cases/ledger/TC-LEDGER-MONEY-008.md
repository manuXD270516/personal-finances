---
id: TC-LEDGER-MONEY-008
title: "Propiedad: la suma de Money es exacta, conmutativa y asociativa"
spec: ledger/journal-posting
related_specs: []
requirement: "Aritmética monetaria decimal exacta"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-006]
nfr: []
invariants: [INV-001]
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 1
tags: ["fast-check", "money"]
error_code: null
preconditions:
  - "Arbitrary arbMoney(c) para una moneda fija c, magnitudes de hasta 10^20 con hasta 18 decimales"
input:
  numRuns_pr: 100
  numRuns_nightly: 10000
steps: ["Generar a, b, c en la misma moneda y evaluar las leyes"]
expected_result:
  - "a + b = b + a"
  - "(a + b) + c = a + (b + c)"
  - "a + b - b = a"
  - "a + 0 = a"
  - "a - a = 0"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-MONEY-008 — Propiedad: la suma de Money es exacta, conmutativa y asociativa

## Intención

La aritmética de punto flotante viola estas leyes (0.1 + 0.2 != 0.3); decimal.js con 40 dígitos debe cumplirlas en el rango soportado.

## Escenario

```gherkin
Dado cualesquiera montos a, b y c en la misma moneda
Cuando se suman en cualquier orden o agrupación
Entonces los resultados son exactamente iguales
```
