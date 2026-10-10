---
id: TC-DEBT-LOAN-031
title: 'Un VIEWER no puede registrar pagos de préstamo'
spec: debt/loans
related_specs: ['security/access-control']
requirement: 'Permisos, auditoría e idempotencia de los préstamos'
scenario: 'VIEWER no registra pagos'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: []
invariants: []
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'rbac']
error_code: INSUFFICIENT_ROLE
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'Un VIEWER registra un pago de 2342.02 BOB del "Préstamo vehicular"'
expected_result:
  - 'Se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transacción'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-031 — Un VIEWER no puede registrar pagos de préstamo

## Intención

Control de acceso por rol.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando un VIEWER registra un pago de 2342.02 BOB del "Préstamo vehicular"
Entonces se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transacción
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
