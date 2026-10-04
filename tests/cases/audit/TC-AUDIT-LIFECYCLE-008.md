---
id: TC-AUDIT-LIFECYCLE-008
title: "El recorrido de una conversión corregida enlaza cada revisión con su detalle"
spec: audit/lifecycle-timeline
related_specs: ["transactions/conversions","fx/conversion-pricing"]
requirement: "Recorrido de una conversión"
scenario: "Conversión corregida"
requirement_status: confirmed
fr: ["FR-AUDIT-010","FR-TRANSACTIONS-024"]
nfr: []
invariants: ["INV-011","INV-008"]
priority: high
type: api
level: application
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/lifecycle.service.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle","conversion","multi-currency"]
error_code: null
preconditions:
  - "\"Wallet USDT\" con 100.000000 USDT y \"Banco BOB\" con 0.00 BOB"
input: {"conversion":{"sent":"100.000000 USDT","received":"685.00 BOB","fee":"5.00 BOB PROVIDER"},"revise":{"received":"686.00 BOB"}}
steps:
  - "Registrar la conversión canónica"
  - "Corregir el monto recibido a 686.00 BOB"
  - "Consultar el recorrido"
expected_result:
  - "Revisión 1 enlazada al ConversionDetail con 685.00 BOB y efectiva 6.85"
  - "REVISE 1 → 2 enlazada al ConversionDetail con 686.00 BOB y efectiva 6.86"
  - "La transición REVISE trae reversed (asiento de la revisión 1), reversal y posted"
created: 2026-10-03
updated: 2026-10-04
---

# TC-AUDIT-LIFECYCLE-008 — El recorrido de una conversión corregida enlaza cada revisión con su detalle

## Intención

El detalle anterior de una conversión no se pierde: el recorrido lleva a él (D11, INV-011).

## Escenario

```gherkin
Dada la conversión de 100.000000 USDT a 685.00 BOB
Cuando corrijo el recibido a 686.00 BOB
Entonces el recorrido enlaza la revisión 1 con efectiva 6.85 y la 2 con efectiva 6.86
```

## Notas

- Cifras del scenario canónico de transactions/conversions.
- Implementación (2026-10-04): cada transición `RECORD`/`REVISE` de una conversión lleva `detailRefs.conversionRevision`; `revisions[n].conversion` trae montos, tasa efectiva y fees del `ConversionDetail` de esa revisión.
