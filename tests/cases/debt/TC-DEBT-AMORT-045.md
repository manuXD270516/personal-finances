---
id: TC-DEBT-AMORT-045
title: "El simulador de pago anticipado responde con p95 menor a 300 ms para 10 préstamos"
spec: debt/amortization
related_specs: []
requirement: "Estrategias avalanche y snowball entre préstamos"
scenario: null
requirement_status: provisional
fr: ["FR-DEBT-010"]
nfr: ["NFR-PERF-004"]
invariants: []
priority: medium
type: platform
level: performance
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["amortization", "simulator", "perf", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "Workspace con 10 préstamos activos en BOB de 360 cuotas cada uno"
  - "Suite `perf` nightly con timeout explícito"
input: {"loans": 10, "installments": 360, "extraMonthly": "500.00"}
steps:
  - "Ejecutar 200 veces `POST W/loans/payoff-simulations` con las estrategias avalanche y snowball y 500.00 BOB extra al mes"
  - "Ejecutar 200 veces la simulación de pagos extra de un préstamo"
expected_result:
  - "p95 del tiempo de servidor < 300 ms en ambos casos"
  - "Ninguna simulación persiste datos"
created: 2026-10-13
updated: 2026-10-13
---

# TC-DEBT-AMORT-045 — El simulador de pago anticipado responde con p95 menor a 300 ms para 10 préstamos

## Intención

El design de `add-loan-amortization-advanced` fijó p95 < 300 ms con 10 préstamos pero el test usa 3 s (docs/38 §4). Este benchmark lo mide sin cambiar la spec (D219, D222).

## Escenario

```gherkin
Dado 10 préstamos de 360 cuotas
Cuando se simulan las estrategias 200 veces
Entonces el p95 es menor a 300 ms
```

## Notas

- Nightly no bloqueante del PR, como TC-REPORTING-SPENDABLE-014.
