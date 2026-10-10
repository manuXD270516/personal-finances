---
id: TC-DEBT-SUMMARY-004
title: 'Interés pagado en el año con desglose por préstamo y tarjeta'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Interés pagado en el año'
scenario: 'Interés del préstamo y de la tarjeta'
requirement_status: provisional
fr: ['FR-DEBT-018', 'FR-DEBT-007']
nfr: []
invariants: ['INV-012', 'INV-002']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['debt-summary', 'interest']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - 'Pagos 2026 de "Préstamo auto" con 3250.40 BOB de interés imputado'
  - 'Gasto "Intereses pagados" de 12.00 USD en "Visa Oro USD" del 2026-08-25; tasa USD/BOB de ese día 9.75'
input:
  range: '2026-01-01..2026-10-28'
steps:
  - 'Consultar el resumen'
expected_result:
  - 'Interés 3250.40 BOB y 12.00 USD; consolidado 3367.40 BOB'
  - 'Atribución: "Préstamo auto" 3250.40 BOB; "Visa Oro" 12.00 USD; otros 0'
  - 'attributionConsistent = true'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-004 — Interés pagado en el año con desglose por préstamo y tarjeta

## Intención

El interés de cada fecha se valora con la tasa de esa fecha (INV-012) y la atribución suma el total.

## Escenario

```gherkin
Dado 3250.40 BOB de interés del préstamo y 12.00 USD de la tarjeta en 2026
Cuando consulto el resumen
Entonces el interés del año es 3367.40 BOB consolidado
```

## Notas

- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
