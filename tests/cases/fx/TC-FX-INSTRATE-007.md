---
id: TC-FX-INSTRATE-007
title: "El estado de providers informa la última tasa por institución y su obsolescencia"
spec: fx/market-rate-providers
related_specs: []
requirement: "Estado de las tasas por institución consultable"
scenario: "Institución cubierta y obsoleta"
requirement_status: provisional
fr: ["FR-FX-016"]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "provider-status", "bank-rates"]
error_code: null
preconditions:
  - "Última BANK_SELL de BAD con vigencia de hace 80 h"
  - "FX_STALE_AFTER_INSTITUTION=72h"
input: {"ageHours": 80}
steps:
  - "GET del estado de providers"
expected_result:
  - "institutions[] incluye BAD con BANK_SELL, antigüedad 80 h y stale = true"
  - "No se llama a ningún proveedor"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-INSTRATE-007 — El estado de providers informa la última tasa por institución y su obsolescencia

## Intención

FR-FX-016 por institución.

## Escenario

```gherkin
Dado BAD con una tasa de hace 80 h
Cuando se consulta el estado
Entonces BAD figura obsoleta
```

## Notas

- Datos ficticios: catálogo "BO" de prueba con fuente "Registro Demo" y entidades "Banco Andino Demo" (`BAD`), "Banco Boliviano Demo" (`BBD`), "Cooperativa Illimani Demo" (`CID`) y "Billetera Altiplano Demo" (`BAL`). Nunca entidades ni montos reales del owner.
- Change: `add-exchange-house-rate-providers`.
