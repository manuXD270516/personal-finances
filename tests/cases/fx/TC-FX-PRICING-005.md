---
id: TC-FX-PRICING-005
title: "Una tasa cotizada que no cuadra con los montos se marca discrepante y prevalecen los montos"
spec: fx/conversion-pricing
related_specs: ["transactions/conversions"]
requirement: "Discrepancia entre la tasa cotizada y los montos"
scenario: "Diferencia mayor a la tolerancia"
requirement_status: confirmed
fr: ["FR-FX-007"]
nfr: []
invariants: ["INV-010","INV-012"]
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","quoted-rate","tolerance"]
error_code: null
preconditions:
  - "Tolerancia = 1 unidad mínima de la moneda destino (0.01 BOB)"
input: {"over":{"source":"100.000000 USDT","quoted":"6.90","fee":"5.00 BOB","target":"684.00 BOB"},"within":{"source":"100.000000 USDT","quoted":"6.90","fee":"5.00 BOB","target":"685.01 BOB"}}
steps:
  - "Registrar la conversión con 684.00 BOB netos"
  - "Registrar la conversión con 685.01 BOB netos"
expected_result:
  - "684.00: se registra; bruto 689.00 vs esperado 690.00; quotedRateDeviation = 1.00 BOB; advertencia en la respuesta; efectiva 6.84"
  - "685.01: se registra sin advertencia (diferencia 0.01 BOB ≤ tolerancia)"
  - "En ambos casos el asiento usa los montos reales"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PRICING-005 — Una tasa cotizada que no cuadra con los montos se marca discrepante y prevalecen los montos

## Intención

Los montos reales mandan; la tasa cotizada es informativa (docs/09 §7.2).

## Escenario

```gherkin
Cuando registro 100.000000 USDT a cotizada 6.90 con fee 5.00 BOB y recibo 684.00 BOB
Entonces la conversión usa 684.00 BOB
  Y se advierte una discrepancia de 1.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
