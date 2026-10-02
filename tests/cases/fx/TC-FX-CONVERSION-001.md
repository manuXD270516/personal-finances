---
id: TC-FX-CONVERSION-001
title: "Propiedad: convertir y revertir con la tasa inversa devuelve el original con un margen de una unidad menor"
spec: fx/conversion-pricing
related_specs: []
requirement: "Valorización de conversiones"
scenario: null
requirement_status: provisional
fr: [FR-FX-002]
nfr: []
invariants: [INV-020, INV-001]
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["fast-check", "fx"]
error_code: null
preconditions:
  - "Arbitraries: pares de monedas entre BOB, USD, USDT, BTC; tasas como cadenas decimales en (0.000001, 1000000); montos arbMoney(source)"
input:
  numRuns_pr: 100
  numRuns_nightly: 10000
  fees: "ninguna"
steps:
  - "y = round(x * r, target.scale) con HALF_EVEN"
  - "x2 = round(y * (1/r), source.scale) calculado con 40 dígitos de precisión"
expected_result:
  - "|x2 - x| <= max(1 unidad menor de source, 0.5 * r^-1 * 10^-target.scale redondeado hacia arriba)"
  - "La conversión de cero es cero"
  - "Los resultados son deterministas"
created: 2026-10-01
updated: 2026-10-01
---

# TC-FX-CONVERSION-001 — Propiedad: convertir y revertir con la tasa inversa devuelve el original con un margen de una unidad menor

## Intención

Detecta pérdida de precisión y redondeo inconsistente en el servicio de valorización; la tolerancia considera la escala más gruesa de la moneda destino.

## Escenario

```gherkin
Dado cualquier monto x y cualquier tasa r entre dos monedas
Cuando x se convierte con r y el resultado se revierte con 1/r
Entonces el resultado difiere de x en no más que la tolerancia de redondeo permitida
```

## Notas

- La fórmula exacta de la tolerancia queda por confirmar en SPIKE-03 (Money & rounding).
