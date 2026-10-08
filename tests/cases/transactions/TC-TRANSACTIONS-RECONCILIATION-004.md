---
id: TC-TRANSACTIONS-RECONCILIATION-004
title: "En una tarjeta de crédito el saldo confirmado se expresa como deuda positiva"
spec: transactions/reconciliation
related_specs: []
requirement: "Saldo confirmado y diferencia de la sesión"
scenario: "Tarjeta de crédito expresada como deuda"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["reconciliation", "liability"]
error_code: null
preconditions:
  - "Tarjeta \"Visa\" (LIABILITY, BOB) sin saldo inicial"
  - "Gastos cleared de 400.00 BOB (2026-03-10) y 120.00 BOB (2026-03-22)"
input:
  statementDate: "2026-03-31"
  statementBalance: "520.00"
steps:
  - "Iniciar sesión de \"Visa\" al 2026-03-31 por una deuda de 520.00 BOB"
  - "Consultar la sesión"
expected_result:
  - "Saldo confirmado: deuda 520.00 BOB"
  - "Diferencia 0.00 BOB"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-004 — En una tarjeta de crédito el saldo confirmado se expresa como deuda positiva

## Intención

El signo de pasivos debe coincidir con cómo el usuario lee el extracto de su tarjeta.

## Escenario

```gherkin
Dado la "Visa" con gastos cleared de 400.00 BOB y 120.00 BOB
Cuando la sesión tiene extracto por una deuda de 520.00 BOB
Entonces el saldo confirmado es una deuda de 520.00 BOB
  Y la diferencia es 0.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
