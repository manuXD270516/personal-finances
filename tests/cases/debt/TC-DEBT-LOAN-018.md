---
id: TC-DEBT-LOAN-018
title: 'Un desglose que no suma el monto pagado se rechaza'
spec: debt/loans
related_specs: []
requirement: 'Desglose indicado por el usuario'
scenario: 'Desglose que no suma el pago'
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
tags: ['loans', 'payment', 'breakdown']
error_code: PAYMENT_BREAKDOWN_MISMATCH
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR registra un pago de 2400.00 BOB indicando principal 1862.85 BOB, interés 479.17 BOB y comisiones 50.00 BOB'
expected_result:
  - 'Se rechaza con `PAYMENT_BREAKDOWN_MISMATCH` (2392.02 BOB indicados frente a 2400.00 BOB) y no se crea ninguna transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-018 — Un desglose que no suma el monto pagado se rechaza

## Intención

INV-016: principal + interés + comisiones + seguro + impuestos = pago.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra un pago de 2400.00 BOB indicando principal 1862.85 BOB, interés 479.17 BOB y comisiones 50.00 BOB
Entonces se rechaza con `PAYMENT_BREAKDOWN_MISMATCH` (2392.02 BOB indicados frente a 2400.00 BOB) y no se crea ninguna transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
