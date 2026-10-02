---
id: TC-FX-PRICING-001
title: "La valorización de conversiones calcula la tasa efectiva y las comisiones totales a partir de la tasa cotizada y los montos"
spec: fx/conversion-pricing
related_specs: ["transactions/conversions"]
requirement: "Tasa efectiva derivada de los montos reales"
scenario: "Venta de USDT por BOB"
requirement_status: confirmed
fr: ["FR-FX-007","FR-TRANSACTIONS-022"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-010","INV-001","INV-020"]
priority: critical
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["fx","pricing"]
error_code: null
preconditions:
  - "ConversionCalculator del dominio (decimal.js precisión 40, HALF_EVEN)"
input: {"sent":"100.000000 USDT","quoted_rate":"USDT/BOB 6.90","fees":[{"type":"PROVIDER","amount":"5.00 BOB"}],"reference_rate":"USDT/BOB 6.95","buy_case":{"sent":"700.00 BOB","received":"99.900000 USDT"}}
steps:
  - "Valorizar la venta"
  - "Valorizar la compra del caso buy_case"
expected_result:
  - "Monto destino bruto = 690.00 BOB; neto recibido = 685.00 BOB"
  - "Tasa efectiva = USDT/BOB 6.850000000000000000 (las tasas no se redondean a la escala de la moneda)"
  - "Comisiones totales = 5.00 BOB = (cotizada − efectiva) × 100"
  - "Spread frente a la referencia = 0.719424460431654676 % (5.00 BOB)"
  - "Compra: efectiva USDT/BOB = 7.007007007007007007"
created: 2026-10-01
updated: 2026-10-02
---

# TC-FX-PRICING-001 — La valorización de conversiones calcula la tasa efectiva y las comisiones totales a partir de la tasa cotizada y los montos

## Intención

Los metadatos de valorización guardados en ConversionDetail deben derivarse de forma consistente para que el análisis histórico de los costos P2P sea confiable.

## Escenario

```gherkin
Dado que se venden 100.000000 USDT a una tasa cotizada de 6.90 BOB con una comisión de 5.00 BOB
Cuando se valoriza la conversión
Entonces el monto neto recibido es 685.00 BOB
  Y la tasa efectiva es 6.85 BOB por USDT
```

## Notas

- Referencia corregida de 6.96 a 6.95 para coincidir con ARCHITECTURE §4.2 y docs/09 §6.14; el spread se expresa en % (×100).
