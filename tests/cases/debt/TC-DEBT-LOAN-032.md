---
id: TC-DEBT-LOAN-032
title: 'El reintento con la misma clave de idempotencia no duplica el pago'
spec: debt/loans
related_specs: []
requirement: 'Permisos, auditoría e idempotencia de los préstamos'
scenario: 'Reintento del registro de un pago'
requirement_status: provisional
fr: ['FR-DEBT-007']
nfr: ['NFR-REL-007']
invariants: ['INV-027']
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['loans', 'idempotency']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El cliente envía dos veces el pago de 2342.02 BOB de la cuota 1 con la misma clave de idempotencia'
expected_result:
  - 'Ambas respuestas devuelven el mismo pago y existe una sola transacción, y la deuda baja una sola vez a 48137.15 BOB'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-032 — El reintento con la misma clave de idempotencia no duplica el pago

## Intención

NFR-REL-007: un reintento de red no debe pagar dos veces.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el cliente envía dos veces el pago de 2342.02 BOB de la cuota 1 con la misma clave de idempotencia
Entonces ambas respuestas devuelven el mismo pago y existe una sola transacción, y la deuda baja una sola vez a 48137.15 BOB
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
