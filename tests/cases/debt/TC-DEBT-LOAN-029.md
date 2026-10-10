---
id: TC-DEBT-LOAN-029
title: 'El detalle muestra pendiente, saldo de la cuenta, atrasadas e interés pagado'
spec: debt/loans
related_specs: []
requirement: 'Detalle y estado del préstamo'
scenario: 'Detalle tras la primera cuota'
requirement_status: provisional
fr: ['FR-DEBT-007', 'FR-DEBT-001']
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'detail']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock 2026-12-16T12:00 America/La_Paz'
  - '"Préstamo vehicular" desembolsado con la cuota 1 pagada'
input: {}
steps:
  - 'Hoy es 2026-12-16 en America/La_Paz, la cuota 1 está pagada con 2342.02 BOB y la cuota 2 del 2026-12-15 está sin pagar'
expected_result:
  - 'El principal pendiente es 48137.15 BOB, igual al saldo adeudado de la cuenta, con diferencia 0.00 BOB'
  - 'La cuota 2 figura atrasada y el interés pagado acumulado es 479.17 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-029 — El detalle muestra pendiente, saldo de la cuenta, atrasadas e interés pagado

## Intención

El detalle concilia cronograma y ledger y deriva las atrasadas con hoy en la TZ del workspace (RISK-020).

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock 2026-12-16T12:00 America/La_Paz
  Y "Préstamo vehicular" desembolsado con la cuota 1 pagada
Cuando hoy es 2026-12-16 en America/La_Paz, la cuota 1 está pagada con 2342.02 BOB y la cuota 2 del 2026-12-15 está sin pagar
Entonces el principal pendiente es 48137.15 BOB, igual al saldo adeudado de la cuenta, con diferencia 0.00 BOB
  Y la cuota 2 figura atrasada y el interés pagado acumulado es 479.17 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
