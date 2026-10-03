---
id: TC-FX-CONVERSION-001
title: "Propiedad: convertir y revertir con la tasa inversa devuelve el original con un margen de una unidad menor"
spec: fx/market-rates
related_specs: ["fx/conversion-pricing"]
requirement: "Uso de la tasa inversa sin pérdida de precisión"
scenario: "Valorar BOB en USD con la tasa original"
requirement_status: confirmed
fr: ["FR-FX-004"]
nfr: ["NFR-DATA-002"]
invariants: ["INV-020","INV-001","INV-032"]
priority: high
type: property
level: property
automation_status: automated
automated_tests:
  - packages/contexts/fx/src/domain/rate-resolver.test.ts
  - packages/contexts/fx/src/domain/fx.properties.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["fast-check","fx","inverse"]
error_code: null
preconditions:
  - "Arbitraries: pares de monedas entre BOB, USD, USDT, BTC; tasas como cadenas decimales en (0.000001, 1000000); montos arbMoney(source)"
input: {"numRuns_pr":100,"numRuns_nightly":10000,"fees":"ninguna","example":{"rate":"USD/BOB 6.96","amount":"1000.00 BOB","expected":"143.68 USD","inverse_display":"0.143678160919540230"}}
steps:
  - "y = round(x * r, target.scale) con HALF_EVEN"
  - "x2 = round(y / r, source.scale) usando la tasa original r (nunca su inversa redondeada), precisión 40"
expected_result:
  - "|x2 - x| <= max(1 unidad menor de source, 0.5 * r^-1 * 10^-target.scale redondeado hacia arriba)"
  - "Ejemplo: 1000.00 BOB / 6.96 = 143.68 USD; la inversa mostrada es 0.143678160919540230"
  - "|1/(1/r) − r| / r < 10^-38 (error relativo, INV-032)"
  - "La conversión de cero es cero y los resultados son deterministas"
created: 2026-10-01
updated: 2026-10-03
---

# TC-FX-CONVERSION-001 — Propiedad: convertir y revertir con la tasa inversa devuelve el original con un margen de una unidad menor

## Intención

Detecta pérdida de precisión y redondeo inconsistente al usar tasas inversas; la tolerancia considera la escala más gruesa de la moneda destino.

## Escenario

```gherkin
Dado cualquier monto x y cualquier tasa r entre dos monedas
Cuando x se convierte con r y el resultado se revierte dividiendo por r
Entonces el resultado difiere de x en no más que la tolerancia de redondeo permitida
```

## Notas

- Tolerancia de la inversa como error relativo (hallazgo de SPIKE-03, INV-032).
- Requirement firme desde el change `add-manual-conversions`.
