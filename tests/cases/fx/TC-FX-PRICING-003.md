---
id: TC-FX-PRICING-003
title: "Sin tasa de referencia o sin tasa cotizada el spread queda no determinable"
spec: fx/conversion-pricing
related_specs: ["transactions/conversions"]
requirement: "Spread no determinable"
scenario: "Sin tasa de referencia"
requirement_status: confirmed
fr: ["FR-FX-007"]
nfr: []
invariants: ["INV-012"]
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","spread","missing-rate"]
error_code: null
preconditions:
  - "No existe tasa USDT/BOB dentro de la ventana de 7 días antes de 2026-09-30T14:42:00-04:00"
input: {"source":"100.000000 USDT","target":"685.00 BOB","fee":"5.00 BOB PROVIDER","quoted":"6.90","executedAt":"2026-09-30T14:42:00-04:00"}
steps:
  - "Registrar la conversión sin referencia disponible"
  - "Registrar otra igual sin tasa cotizada y con referencia 6.95 disponible"
expected_result:
  - "Primera: referenceRate = null, spread = null, effectiveRate = 6.85"
  - "Segunda: referenceRate = 6.95 registrada, spread = null"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PRICING-003 — Sin tasa de referencia o sin tasa cotizada el spread queda no determinable

## Intención

Nunca estimar el spread con un valor por defecto: un spread inventado falsea el análisis de costos.

## Escenario

```gherkin
Dado que no hay tasa USDT/BOB vigente
Cuando registro la venta de 100.000000 USDT por 685.00 BOB a cotizada 6.90
Entonces la referencia y el spread quedan vacíos
  Y la tasa efectiva es 6.85
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
