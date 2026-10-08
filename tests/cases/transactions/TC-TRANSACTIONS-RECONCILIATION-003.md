---
id: TC-TRANSACTIONS-RECONCILIATION-003
title: "El saldo confirmado suma saldo inicial y cleared hasta la fecha del extracto"
spec: transactions/reconciliation
related_specs: ["ledger/balances"]
requirement: "Saldo confirmado y diferencia de la sesión"
scenario: "Diferencia cero en una cuenta de activo"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-LEDGER-012]
nfr: []
invariants: [INV-023, INV-033]
priority: critical
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - apps/web/src/ui/reconciliation/reconciliation.test.tsx
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - packages/contexts/transactions/src/domain/reconciliation-calculator.test.ts
  - packages/contexts/transactions/test/integration/pg-reconciliations.int.test.ts
status: automated
regression_suite: true
phase: 2
tags: ["reconciliation", "money"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión de \"Bank A\" al 2026-03-31 por 3350.00 BOB"
input:
  statementBalance: "3350.00"
  statementBalanceAlt: "3345.00"
steps:
  - "Consultar la sesión"
  - "Cambiar el saldo del extracto a 3345.00 BOB (sesión nueva) y consultar"
expected_result:
  - "Saldo confirmado 3350.00 BOB (1000.00 − 150.00 + 2500.00) y diferencia 0.00 BOB"
  - "G2 (posted) y G3 (fecha 2026-04-02) no suman"
  - "Con 3345.00 BOB la diferencia es −5.00 BOB"
  - "Saldo contable de \"Bank A\" 3104.10 BOB sin cambios"
  - "El saldo inicial se cuenta una sola vez"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-003 — El saldo confirmado suma saldo inicial y cleared hasta la fecha del extracto

## Intención

Protege la fórmula del saldo confirmado (decisión 1 del design): base de la diferencia que debe llegar a cero.

## Escenario

```gherkin
Dado "Bank A" con saldo inicial 1000.00 BOB, G1 y I1 cleared, G2 posted y G3 cleared posterior al extracto
Cuando se consulta la sesión al 2026-03-31 por 3350.00 BOB
Entonces el saldo confirmado es 3350.00 BOB y la diferencia 0.00 BOB
  Y el saldo contable sigue en 3104.10 BOB
```

## Notas

- PBT: diferencia = extracto − (saldo inicial + Σ incluidas) para conjuntos aleatorios.
