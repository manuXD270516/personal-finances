---
id: TC-DEBT-LOAN-020
title: 'Anular el último pago revierte el asiento y devuelve la cuota a no pagada'
spec: debt/loans
related_specs: []
requirement: 'Anular un pago de préstamo'
scenario: 'Anular el último pago'
requirement_status: confirmed
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-008', 'INV-016']
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'payment', 'void']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'La cuota 1 está pagada con 2342.02 BOB y el EDITOR anula ese pago con motivo "monto equivocado"'
expected_result:
  - 'La transacción queda anulada con su reversa, "Préstamo vehicular" vuelve a adeudar 50000.00 BOB y la cuota 1 vuelve a no pagada'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-020 — Anular el último pago revierte el asiento y devuelve la cuota a no pagada

## Intención

Correcciones por reversa (INV-008) y la imputación vuelve atrás en la misma unidad de trabajo.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando la cuota 1 está pagada con 2342.02 BOB y el EDITOR anula ese pago con motivo "monto equivocado"
Entonces la transacción queda anulada con su reversa, "Préstamo vehicular" vuelve a adeudar 50000.00 BOB y la cuota 1 vuelve a no pagada
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
