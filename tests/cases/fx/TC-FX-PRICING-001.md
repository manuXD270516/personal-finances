---
id: TC-FX-PRICING-001
title: "La valorización de conversiones calcula la tasa efectiva y las comisiones totales a partir de la tasa cotizada y los montos"
spec: fx/conversion-pricing
related_specs: ["transactions/conversions"]
requirement: "Valorización de conversiones"
scenario: null
requirement_status: provisional
fr: [FR-FX-002]
nfr: []
invariants: [INV-011, INV-001]
priority: high
type: unit
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["fx", "pricing"]
error_code: null
preconditions: ["Servicio de dominio de valorización de conversiones"]
input:
  sent: "100.000000 USDT"
  quoted_rate: "6.90"
  fees:
    - type: "PROVIDER"
      amount: "5.00 BOB"
  reference_rate: "6.96"
steps: ["Valorizar la conversión"]
expected_result:
  - "Monto destino bruto = 690.00 BOB"
  - "Neto recibido = 685.00 BOB"
  - "Tasa efectiva = 6.850000000000000000 BOB por USDT (las tasas no se redondean a la escala de la moneda)"
  - "Comisiones totales = 5.00 BOB = (cotizada - efectiva) * 100"
  - "Spread frente a la referencia = 0.06 BOB por USDT (6.96 - 6.90)"
created: 2026-10-01
updated: 2026-10-01
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
