---
id: TC-FX-PRICING-004
title: "El costo total suma fees y spread valorados a la referencia con un solo redondeo"
spec: fx/conversion-pricing
related_specs: ["transactions/conversions"]
requirement: "Costo total de la conversión en moneda de reporte"
scenario: "Costo del ejemplo canónico"
requirement_status: confirmed
fr: ["FR-FX-007","FR-TRANSACTIONS-025"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-020"]
priority: high
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags: ["fx","cost"]
error_code: null
preconditions:
  - "Moneda de reporte BOB"
  - "Referencia USDT/BOB 6.95 al instante de ejecución"
  - "Sin tasa TRX/BOB vigente"
input: {"canonical":{"source":"100.000000 USDT","target":"685.00 BOB","quoted":"6.90","fee":"5.00 BOB"},"buy":{"paid":"700.00 BOB","received":"99.900000 USDT","quoted":"7.00","fee":"0.100000 USDT"},"swap":{"network_fee":"15.000000 TRX"}}
steps:
  - "Calcular el costo de la venta canónica"
  - "Calcular el costo de la compra con fee en USDT"
  - "Calcular el costo del swap con fee TRX sin tasa"
expected_result:
  - "Canónica: 10.00 BOB = 5.00 fee + 5.00 spread = 100.000000 × 6.95 − 685.00"
  - "Compra: 0.695 + 5.00 = 5.695 → 5.70 BOB (HALF_EVEN una sola vez)"
  - "Swap: costo marcado complete = false con missingValuations = [15.000000 TRX]"
created: 2026-10-02
updated: 2026-10-02
---

# TC-FX-PRICING-004 — El costo total suma fees y spread valorados a la referencia con un solo redondeo

## Intención

FR-FX-007/FR-TRANSACTIONS-025: el usuario debe ver cuánto le costó realmente convertir; redondear por componente introduciría deriva.

## Escenario

```gherkin
Dada la venta canónica con fee 5.00 BOB y referencia 6.95
Cuando calculo el costo total en BOB
Entonces es 10.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
