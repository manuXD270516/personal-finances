---
id: TC-DEBT-LOAN-001
title: 'Registrar un préstamo francés nuevo lo deja en borrador con su vista previa y sin asientos'
spec: debt/loans
related_specs: []
requirement: 'Registrar un préstamo con sus condiciones'
scenario: 'Préstamo vehicular en borrador'
requirement_status: confirmed
fr: ['FR-DEBT-001']
nfr: []
invariants: ['INV-001', 'INV-002']
priority: critical
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/loans.api.test.ts
  - apps/web/src/ui/debt/logic.test.ts
  - packages/contexts/debt/src/domain/loan.test.ts
  - tests/e2e/specs/loans.spec.ts
status: automated
regression_suite: false
phase: 4
tags: ['loans', 'register']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz y FixedClock'
  - 'Fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos'
input:
  principal: '50000.00 BOB'
  annualRate: '11.50 %'
  dayCount: '30/360'
  frequency: 'MONTHLY'
  term: '24'
  disbursementDate: '2026-10-15'
  firstDueDate: '2026-11-15'
steps:
  - 'El EDITOR registra "Préstamo vehicular" de 50000.00 BOB al 11.50 % nominal anual fijo, convención 30/360, mensual, 24 cuotas, desembolso el 2026-10-15, primera cuota el 2026-11-15, sistema francés, prestamista "Banco Andino", cuenta del préstamo "Préstamo vehicular" (`loan`, BOB) y destino "Banco BOB"'
expected_result:
  - 'El préstamo queda en borrador con una vista previa de 24 cuotas de 2342.02 BOB (la última de 2341.90 BOB)'
  - 'El saldo de "Préstamo vehicular" sigue en 0.00 BOB y no existe ninguna transacción del préstamo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-LOAN-001 — Registrar un préstamo francés nuevo lo deja en borrador con su vista previa y sin asientos

## Intención

FR-DEBT-001: el préstamo nace en borrador con sus condiciones completas; registrar no debe tocar el ledger hasta el desembolso.

## Escenario

```gherkin
Dado workspace en BOB con zona America/La_Paz y FixedClock
  Y fixture "Préstamo vehicular" (50000.00 BOB, 11.50 % anual, 30/360, mensual, 24 cuotas, desembolso 2026-10-15, primera cuota 2026-11-15) y "Banco BOB", salvo que el scenario indique otros datos
Cuando el EDITOR registra "Préstamo vehicular" de 50000.00 BOB al 11.50 % nominal anual fijo, convención 30/360, mensual, 24 cuotas, desembolso el 2026-10-15, primera cuota el 2026-11-15, sistema francés, prestamista "Banco Andino", cuenta del préstamo "Préstamo vehicular" (`loan`, BOB) y destino "Banco BOB"
Entonces el préstamo queda en borrador con una vista previa de 24 cuotas de 2342.02 BOB (la última de 2341.90 BOB)
  Y el saldo de "Préstamo vehicular" sigue en 0.00 BOB y no existe ninguna transacción del préstamo
```

## Notas

- Change: `add-loans` (borrador; cifras con `FixedClock` en America/La_Paz, recalculadas con Decimal y HALF_EVEN).
