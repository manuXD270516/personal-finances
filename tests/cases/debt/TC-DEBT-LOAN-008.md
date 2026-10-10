---
id: TC-DEBT-LOAN-008
title: 'La comisión retenida en el desembolso es gasto y la deuda se reconoce por el principal completo'
spec: debt/loans
related_specs: []
requirement: 'Desembolso registrado como transacción'
scenario: 'Desembolso con comisión retenida por el banco'
requirement_status: provisional
fr: ['FR-DEBT-002']
nfr: []
invariants: ['INV-004', 'INV-030']
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'disbursement', 'fees']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - '"Banco BOB" tiene 1000.00 BOB y el EDITOR desembolsa el préstamo de 50000.00 BOB con una comisión de originación retenida de 500.00 BOB'
expected_result:
  - '"Banco BOB" tiene 50500.00 BOB, "Préstamo vehicular" adeuda 50000.00 BOB y el gasto en "Comisiones de préstamo" del 2026-10-15 es 500.00 BOB'
  - 'El asiento suma 0.00 BOB (49500.00 + 500.00 − 50000.00) y el patrimonio neto baja exactamente 500.00 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-008 — La comisión retenida en el desembolso es gasto y la deuda se reconoce por el principal completo

## Intención

docs/09 §6.9: la deuda es el principal completo aunque se acredite el neto; la comisión es gasto.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando "Banco BOB" tiene 1000.00 BOB y el EDITOR desembolsa el préstamo de 50000.00 BOB con una comisión de originación retenida de 500.00 BOB
Entonces "Banco BOB" tiene 50500.00 BOB, "Préstamo vehicular" adeuda 50000.00 BOB y el gasto en "Comisiones de préstamo" del 2026-10-15 es 500.00 BOB
  Y el asiento suma 0.00 BOB (49500.00 + 500.00 − 50000.00) y el patrimonio neto baja exactamente 500.00 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
