---
id: TC-FX-USERCONV-003
title: "Una conversión revisada reemplaza su observación y una anulada la marca, sin modificar valores"
spec: fx/market-rates
related_specs: []
requirement: "Observación de una conversión revisada o anulada"
scenario: "Venta revisada"
requirement_status: provisional
fr: ["FR-FX-003", "FR-FX-011"]
nfr: ["NFR-DATA-006"]
invariants: ["INV-011"]
priority: high
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "user-conversion", "revision", "void"]
error_code: null
preconditions:
  - "Observación 11.900000000000000000 de la venta de 100.000000 USDT por 1190.00 BOB"
input: {}
steps:
  - "Revisar la venta a 1188.00 BOB y entregar ConversionRevised.v1"
  - "En otro escenario, anularla y entregar TransactionVoided.v1"
expected_result:
  - "Observación nueva 11.880000000000000000 que reemplaza a la de 11.90 con motivo \"conversión revisada\"; la anterior sigue consultable y marcada reemplazada"
  - "Con la anulación, la observación sigue con 11.90 y marcada anulada"
  - "Regresión: TC-FX-HISTORICAL-001/002"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-USERCONV-003 — Una conversión revisada reemplaza su observación y una anulada la marca, sin modificar valores

## Intención

Inmutabilidad de las tasas (INV-011) aplicada a las observaciones.

## Escenario

```gherkin
Dado la observación de 11.90
Cuando la venta se revisa a 1188.00 BOB
Entonces una observación de 11.88 la reemplaza
```

## Notas

- Cubre el scenario "Venta anulada".
