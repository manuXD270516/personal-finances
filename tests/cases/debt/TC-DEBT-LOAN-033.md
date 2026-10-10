---
id: TC-DEBT-LOAN-033
title: 'El pago publica un único hecho con el desglose y el pendiente'
spec: debt/loans
related_specs: ['platform/event-delivery']
requirement: 'Hechos publicados de los préstamos'
scenario: 'Pago publicado'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'events']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR paga la cuota 1 de 2342.02 BOB'
expected_result:
  - 'Se publica un único hecho de pago con la cuota 1, el desglose (principal "1862.85", interés "479.17", comisiones "0.00", seguro "0.00", impuestos "0.00", total "2342.02") en BOB y el principal pendiente "48137.15"'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-033 — El pago publica un único hecho con el desglose y el pendiente

## Intención

Reporting y Notify consumen el hecho; montos como texto decimal.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR paga la cuota 1 de 2342.02 BOB
Entonces se publica un único hecho de pago con la cuota 1, el desglose (principal "1862.85", interés "479.17", comisiones "0.00", seguro "0.00", impuestos "0.00", total "2342.02") en BOB y el principal pendiente "48137.15"
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
