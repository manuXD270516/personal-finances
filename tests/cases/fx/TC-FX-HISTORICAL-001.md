---
id: TC-FX-HISTORICAL-001
title: "Una conversión histórica conserva su tasa original tras agregar o corregir tasas"
spec: fx/market-rates
related_specs: ["fx/conversion-pricing","transactions/conversions"]
requirement: "Tasas históricas inmutables"
scenario: "No existe operación de modificación"
requirement_status: confirmed
fr: ["FR-FX-003"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011","INV-012"]
priority: critical
type: integration
level: repository-integration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["fx","history","immutability"]
error_code: null
preconditions:
  - "Tasa de referencia R1 USDT/BOB P2P 6.95 vigente 2026-09-29 (fuente manual)"
  - "Conversión de TC-TRANSACTIONS-CONVERSION-001 registrada el 2026-09-30 referenciando R1"
input: {"new_rate":{"pair":"USDT/BOB","date":"2026-10-15","rate":"7.10"},"correction":{"supersede":"R1","rate":"6.97","reason":"corrección de fuente"},"direct_update":"UPDATE de R1 a 7.00 con el rol de aplicación"}
steps:
  - "Agregar la tasa del 2026-10-15"
  - "Reemplazar R1 por 6.97"
  - "Intentar UPDATE y DELETE directos de R1 con el rol de aplicación"
  - "Leer R1, la conversión, su ConversionDetail y sus postings"
expected_result:
  - "UPDATE y DELETE se rechazan por falta de privilegio (append-only); R1 sigue con 6.95"
  - "La corrección se guarda como R2 = 6.97 que reemplaza a R1 solo para valoraciones futuras"
  - "ConversionDetail sigue mostrando cotizada 6.90, efectiva 6.85 y referencia R1 = 6.95"
  - "Los postings de la conversión no cambian (sin recálculo)"
created: 2026-10-01
updated: 2026-10-02
---

# TC-FX-HISTORICAL-001 — Una conversión histórica conserva su tasa original tras agregar o corregir tasas

## Intención

INV-011 / ARCHITECTURE §4.2: las tasas históricas son inmutables y las operaciones históricas nunca se recalculan con tasas actuales.

## Escenario

```gherkin
Dada una conversión registrada el 2026-09-30 con referencia R1 = 6.95
Cuando se registra una nueva tasa de 7.10 para el 2026-10-15
  Y R1 se corrige a 6.97 por reemplazo
  Y se intenta modificar R1 directamente
Entonces R1 sigue valiendo 6.95
  Y la conversión conserva su referencia y sus postings
```

## Notas

- Antes este TC esperaba el código `FX_RATE_IMMUTABLE`; la API no ofrece operación de modificación, así que la garantía se verifica con los grants de BD (sin código RFC 9457).
