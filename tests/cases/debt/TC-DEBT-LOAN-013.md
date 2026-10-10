---
id: TC-DEBT-LOAN-013
title: 'Comisión y seguro de la cuota se registran en sus categorías de sistema'
spec: debt/loans
related_specs: []
requirement: 'Registrar el pago de cuotas con su desglose'
scenario: 'Cuota con comisión y seguro'
requirement_status: provisional
fr: ['FR-DEBT-007', 'FR-DEBT-006']
nfr: []
invariants: ['INV-016', 'INV-021']
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'payment', 'charges']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El préstamo de 50000.00 BOB tiene una comisión fija de 10.00 BOB por cuota y un seguro del 0.0400 % mensual sobre el saldo, y el EDITOR paga la cuota 1 de 2372.02 BOB'
expected_result:
  - 'La deuda baja 1862.85 BOB y se registran como gasto 479.17 BOB en "Intereses pagados", 10.00 BOB en "Comisiones de préstamo" y 20.00 BOB en "Seguros"'
  - 'No se registra ninguna porción de "Impuestos"'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-013 — Comisión y seguro de la cuota se registran en sus categorías de sistema

## Intención

Cada componente no nulo va a su categoría de sistema; los nulos no generan porciones.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el préstamo de 50000.00 BOB tiene una comisión fija de 10.00 BOB por cuota y un seguro del 0.0400 % mensual sobre el saldo, y el EDITOR paga la cuota 1 de 2372.02 BOB
Entonces la deuda baja 1862.85 BOB y se registran como gasto 479.17 BOB en "Intereses pagados", 10.00 BOB en "Comisiones de préstamo" y 20.00 BOB en "Seguros"
  Y no se registra ninguna porción de "Impuestos"
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
