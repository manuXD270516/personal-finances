---
id: TC-AUDIT-LIFECYCLE-026
title: "La transición reconciliar de una transacción enlaza su sesión y extracto"
spec: audit/lifecycle-timeline
related_specs: ["transactions/reconciliation"]
requirement: "Reconciliación en el recorrido de una transacción"
scenario: "Recorrido de un gasto reconciliado en sesión"
requirement_status: provisional
fr: [FR-AUDIT-010, FR-TRANSACTIONS-030]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["lifecycle", "reconciliation"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión al 2026-03-31 por 3350.00 BOB COMPLETED; ajuste de 5.00 BOB creado por otra sesión"
input:
  - "{\"transaction\":\"G1\"}"
  - "{\"transaction\":\"ajuste 5.00 BOB\"}"
steps:
  - "GET W/transactions/G1/lifecycle"
  - "GET del recorrido del ajuste"
expected_result:
  - "G1: RECORD, CLEAR, RECONCILE; RECONCILE con reconciliationId, statementDate 2026-03-31 y statementBalance \"3350.00\""
  - "Ajuste: RECORD (con asiento) y RECONCILE referenciando la sesión"
created: 2026-10-05
updated: 2026-10-05
---

# TC-AUDIT-LIFECYCLE-026 — La transición reconciliar de una transacción enlaza su sesión y extracto

## Intención

El usuario puede saber contra qué extracto se reconcilió cada transacción.

## Escenario

```gherkin
Dado el gasto de 150.00 BOB registrado, confirmado y reconciliado en la sesión al 2026-03-31
Cuando se consulta su recorrido
Entonces la transición reconciliar enlaza la sesión al 2026-03-31 por 3350.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
