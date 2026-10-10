---
id: TC-DEBT-LOAN-024
title: 'Un pago parcial deja la ocurrencia esperando el pendiente'
spec: debt/loans
related_specs: ['commitments/recurrence-engine']
requirement: 'Pago registrado resuelve la ocurrencia de la cuota'
scenario: 'Pago parcial reduce lo esperado'
requirement_status: provisional
fr: ['FR-DEBT-011']
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
tags: ['loans', 'commitments', 'partial']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - 'El EDITOR paga 2000.00 BOB de la cuota 1 de 2372.02 BOB'
expected_result:
  - 'La ocurrencia de la cuota 1 sigue sin resolver y espera 372.02 BOB'
  - 'El comprometido de noviembre incluye 372.02 BOB por esa cuota'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-024 — Un pago parcial deja la ocurrencia esperando el pendiente

## Intención

Sin esto Q4 contaría la cuota completa o nada después de un pago parcial.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR paga 2000.00 BOB de la cuota 1 de 2372.02 BOB
Entonces la ocurrencia de la cuota 1 sigue sin resolver y espera 372.02 BOB
  Y el comprometido de noviembre incluye 372.02 BOB por esa cuota
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
