---
id: TC-DEBT-LOAN-012
title: 'El pago de la cuota separa el principal (reduce la deuda) del interés (gasto)'
spec: debt/loans
related_specs: []
requirement: 'Registrar el pago de cuotas con su desglose'
scenario: 'Pago exacto de la primera cuota'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-016', 'INV-004', 'INV-009']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'payment']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - '"Banco BOB" tiene 51000.00 BOB y el EDITOR registra el 2026-11-15 un pago de 2342.02 BOB del "Préstamo vehicular" desde "Banco BOB"'
expected_result:
  - '"Banco BOB" tiene 48657.98 BOB, "Préstamo vehicular" adeuda 48137.15 BOB y el gasto en "Intereses pagados" del 2026-11-15 es 479.17 BOB'
  - 'La cuota 1 queda pagada con principal 1862.85 BOB e interés 479.17 BOB, y el asiento suma 0.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-012 — El pago de la cuota separa el principal (reduce la deuda) del interés (gasto)

## Intención

FR-DEBT-007 e INV-016: el pago es una transacción que reduce el pasivo por el principal y registra el interés como gasto; la suma de componentes es el pago.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando "Banco BOB" tiene 51000.00 BOB y el EDITOR registra el 2026-11-15 un pago de 2342.02 BOB del "Préstamo vehicular" desde "Banco BOB"
Entonces "Banco BOB" tiene 48657.98 BOB, "Préstamo vehicular" adeuda 48137.15 BOB y el gasto en "Intereses pagados" del 2026-11-15 es 479.17 BOB
  Y la cuota 1 queda pagada con principal 1862.85 BOB e interés 479.17 BOB, y el asiento suma 0.00 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
