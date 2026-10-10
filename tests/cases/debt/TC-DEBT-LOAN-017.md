---
id: TC-DEBT-LOAN-017
title: 'El desglose del recibo con interés moratorio se registra y muestra la diferencia'
spec: debt/loans
related_specs: []
requirement: 'Desglose indicado por el usuario'
scenario: 'Pago con interés moratorio'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-016']
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'payment', 'breakdown']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra el 2026-11-20 un pago de 2360.00 BOB de la cuota 1 de 2342.02 BOB indicando principal 1862.85 BOB e interés 497.15 BOB'
expected_result:
  - 'La cuota 1 queda pagada, el gasto en "Intereses pagados" es 497.15 BOB y la cuota muestra una diferencia de interés de +17.98 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-017 — El desglose del recibo con interés moratorio se registra y muestra la diferencia

## Intención

Los recibos reales difieren de lo esperado (mora); el desglose indicado manda y la diferencia queda visible.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra el 2026-11-20 un pago de 2360.00 BOB de la cuota 1 de 2342.02 BOB indicando principal 1862.85 BOB e interés 497.15 BOB
Entonces la cuota 1 queda pagada, el gasto en "Intereses pagados" es 497.15 BOB y la cuota muestra una diferencia de interés de +17.98 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
