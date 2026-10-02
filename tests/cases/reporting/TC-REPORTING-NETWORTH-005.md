---
id: TC-REPORTING-NETWORTH-005
title: "Propiedad: transferencias no cambian el patrimonio y una conversión lo reduce en fee más spread"
spec: reporting/net-worth
related_specs: ["transactions/transfers","transactions/conversions"]
requirement: "Transferencias y pagos de tarjeta no cambian el patrimonio"
scenario: "Conversión canónica valorada a la referencia"
requirement_status: confirmed
fr: ["FR-REPORTING-005","FR-TRANSACTIONS-018"]
nfr: []
invariants: ["INV-009","INV-031","INV-010"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["net-worth","fast-check","invariant"]
error_code: null
preconditions:
  - "Ledger generado aleatoriamente con cuentas BOB, USD, USDT incluidas en patrimonio"
  - "Tasas de valoración fijas: USDT/BOB 6.95, USD/BOB 6.96"
input: {"card_payment":"400.00 BOB de Banco BOB a Visa","conversion":{"source":"100.000000 USDT","target":"685.00 BOB","quoted":"6.90","fee":"5.00 BOB"},"numRuns_pr":100,"numRuns_nightly":10000}
steps:
  - "Calcular NW antes y después de transferencias aleatorias sin fee"
  - "Calcular NW antes y después de la conversión canónica"
expected_result:
  - "∀ transferencia sin fee entre cuentas incluidas: ΔNW = 0 (pago de tarjeta de 400.00 BOB incluido)"
  - "Conversión canónica: ΔNW = −10.00 BOB (5.00 fee + 5.00 spread a 6.95)"
  - "∀ conversión: ΔNW = −(fees + spread) valorados a la tasa de valoración"
created: 2026-10-02
updated: 2026-10-02
---

# TC-REPORTING-NETWORTH-005 — Propiedad: transferencias no cambian el patrimonio y una conversión lo reduce en fee más spread

## Intención

INV-009/INV-031: mover dinero entre cuentas propias no crea ni destruye riqueza; convertir cuesta exactamente fee + spread.

## Escenario

```gherkin
Dado un patrimonio valorado con USDT/BOB 6.95
Cuando convierto 100.000000 USDT en 685.00 BOB con fee 5.00 BOB a cotizada 6.90
Entonces el patrimonio baja exactamente 10.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
