---
id: TC-DEBT-LOAN-015
title: 'Un pago parcial se imputa a impuestos, seguro, comisiones, interés y principal y deja la cuota parcial'
spec: debt/loans
related_specs: []
requirement: 'Diferencias entre el pago real y la cuota esperada'
scenario: 'Pago parcial de una cuota con cargos'
requirement_status: confirmed
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-016']
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - packages/contexts/debt/src/domain/payment-allocator.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'payment', 'partial']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR paga 2000.00 BOB de la cuota 1 de 2372.02 BOB (principal 1862.85, interés 479.17, comisión 10.00, seguro 20.00)'
expected_result:
  - 'Se imputan 20.00 BOB a seguro, 10.00 BOB a comisión, 479.17 BOB a interés y 1490.83 BOB a principal'
  - 'La cuota 1 queda parcialmente pagada con 372.02 BOB de principal pendiente y una diferencia de −372.02 BOB frente a lo esperado'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-015 — Un pago parcial se imputa a impuestos, seguro, comisiones, interés y principal y deja la cuota parcial

## Intención

FR-DEBT-007: las diferencias entre pago real y cuota esperada deben verse por componente; el orden de imputación decide qué queda pendiente.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR paga 2000.00 BOB de la cuota 1 de 2372.02 BOB (principal 1862.85, interés 479.17, comisión 10.00, seguro 20.00)
Entonces se imputan 20.00 BOB a seguro, 10.00 BOB a comisión, 479.17 BOB a interés y 1490.83 BOB a principal
  Y la cuota 1 queda parcialmente pagada con 372.02 BOB de principal pendiente y una diferencia de −372.02 BOB frente a lo esperado
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
- Incluye el scenario "Completar la cuota parcial": un segundo pago de 372.02 BOB deja la cuota pagada con diferencia 0.00 BOB.
