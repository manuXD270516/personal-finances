---
id: TC-DEBT-LOAN-007
title: 'El desembolso aumenta el activo destino y la deuda por el principal sin cambiar el patrimonio'
spec: debt/loans
related_specs: ['ledger/journal-posting']
requirement: 'Desembolso registrado como transacción'
scenario: 'Desembolso completo'
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
tags: ['loans', 'disbursement', 'ledger']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input: {}
steps:
  - '"Banco BOB" tiene 1000.00 BOB y el EDITOR desembolsa el 2026-10-15 el "Préstamo vehicular" de 50000.00 BOB sin comisión'
expected_result:
  - 'Existe una transacción de desembolso de préstamo del 2026-10-15, "Banco BOB" tiene 51000.00 BOB y "Préstamo vehicular" adeuda 50000.00 BOB'
  - 'El asiento suma 0.00 BOB, el patrimonio neto no cambia y el préstamo queda activo con su cronograma de 24 cuotas'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-007 — El desembolso aumenta el activo destino y la deuda por el principal sin cambiar el patrimonio

## Intención

FR-DEBT-002: el desembolso es una transacción balanceada +ASSET/−LIABILITY; el patrimonio neto no cambia.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando "Banco BOB" tiene 1000.00 BOB y el EDITOR desembolsa el 2026-10-15 el "Préstamo vehicular" de 50000.00 BOB sin comisión
Entonces existe una transacción de desembolso de préstamo del 2026-10-15, "Banco BOB" tiene 51000.00 BOB y "Préstamo vehicular" adeuda 50000.00 BOB
  Y el asiento suma 0.00 BOB, el patrimonio neto no cambia y el préstamo queda activo con su cronograma de 24 cuotas
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
