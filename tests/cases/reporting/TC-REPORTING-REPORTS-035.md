---
id: TC-REPORTING-REPORTS-035
title: "Una transferencia a una cuenta excluida del patrimonio se informa como otros movimientos"
spec: reporting/net-worth
related_specs: []
requirement: "Movimientos con cuentas fuera del patrimonio"
scenario: "Transferencia a una cuenta excluida"
requirement_status: confirmed
fr: ["FR-REPORTING-005", "FR-REPORTING-008"]
nfr: []
invariants: ["INV-009"]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["net-worth", "decomposition"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "\"Fondo familiar\" excluida del patrimonio"
  - "Única operación de 2026-10: transferencia 1000.00 BOB de \"Banco BOB\" a \"Fondo familiar\""
input: {}
steps:
  - "Descomponer el cambio de 2026-10"
expected_result:
  - "Cambio del patrimonio −1000.00 BOB"
  - "Otros movimientos −1000.00 BOB; ahorro y revalorización 0.00"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-035 — Una transferencia a una cuenta excluida del patrimonio se informa como otros movimientos

## Intención

El ahorro no debe confundirse con mover dinero fuera del perímetro del patrimonio.

## Escenario

```gherkin
Dado una transferencia de 1000.00 BOB a una cuenta excluida
Cuando se descompone 2026-10
Entonces se informa como otros movimientos −1000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
