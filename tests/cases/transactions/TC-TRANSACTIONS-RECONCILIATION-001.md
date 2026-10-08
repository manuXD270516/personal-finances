---
id: TC-TRANSACTIONS-RECONCILIATION-001
title: "Iniciar una sesión de reconciliación con fecha y saldo del extracto"
spec: transactions/reconciliation
related_specs: ["identity/workspace-membership"]
requirement: "Iniciar una sesión de reconciliación"
scenario: "Iniciar la reconciliación de marzo"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-IDENTITY-006]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["reconciliation", "session"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
input:
  accountId: "Bank A"
  statementDate: "2026-03-31"
  statementBalance: "3350.00"
steps:
  - "POST W/reconciliations con Idempotency-Key como EDITOR"
expected_result:
  - "201 con la sesión IN_PROGRESS, statementDate 2026-03-31 y statementBalance \"3350.00\""
  - "Ninguna transacción cambia de estado"
  - "Auditoría y transición START registradas"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-001 — Iniciar una sesión de reconciliación con fecha y saldo del extracto

## Intención

FR-TRANSACTIONS-030: la sesión parte de la fecha y el saldo del extracto en la moneda y escala de la cuenta.

## Escenario

```gherkin
Dado "Bank A" en BOB sin sesiones de reconciliación
Cuando el usuario inicia una sesión al 2026-03-31 por 3350.00 BOB
Entonces la sesión queda en curso con esos datos
  Y ninguna transacción queda reconciliada
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
