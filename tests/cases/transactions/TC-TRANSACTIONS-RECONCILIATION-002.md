---
id: TC-TRANSACTIONS-RECONCILIATION-002
title: "La sesión rechaza duplicados, fechas inválidas, escala excedida y rol VIEWER"
spec: transactions/reconciliation
related_specs: []
requirement: "Iniciar una sesión de reconciliación"
scenario: "Segunda sesión en curso para la misma cuenta"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-IDENTITY-006]
nfr: [NFR-SEC-003]
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - packages/contexts/transactions/src/domain/reconciliation.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["reconciliation", "validation"]
error_code: "RECONCILIATION_IN_PROGRESS"
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión S1 de \"Bank A\" IN_PROGRESS"
  - "Sesión S0 de \"Bank A\" COMPLETED con fecha 2026-03-31 (para el caso de fecha)"
input:
  - "{\"case\":\"segunda en curso\",\"statementDate\":\"2026-03-31\"}"
  - "{\"case\":\"fecha anterior a la última completada\",\"statementDate\":\"2026-03-15\"}"
  - "{\"case\":\"fecha futura\",\"statementDate\":\"2026-04-10\"}"
  - "{\"case\":\"escala\",\"statementBalance\":\"3350.005\"}"
  - "{\"case\":\"VIEWER\",\"role\":\"VIEWER\"}"
steps:
  - "Iniciar cada sesión del input en un estado limpio"
expected_result:
  - "409 RECONCILIATION_IN_PROGRESS"
  - "422 RECONCILIATION_STATEMENT_DATE_INVALID (anterior o igual a la última completada)"
  - "422 RECONCILIATION_STATEMENT_DATE_INVALID (futura en la TZ del workspace)"
  - "422 AMOUNT_SCALE_EXCEEDED"
  - "403 INSUFFICIENT_ROLE"
  - "En ningún caso se crea una sesión"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-002 — La sesión rechaza duplicados, fechas inválidas, escala excedida y rol VIEWER

## Intención

Una sesión en curso por cuenta y secuencia estricta de extractos evitan reconciliaciones superpuestas.

## Escenario

```gherkin
Dado "Bank A" con una sesión en curso
Cuando el usuario inicia otra sesión al 2026-03-31
Entonces se rechaza con "RECONCILIATION_IN_PROGRESS"
  Y no se crea ninguna sesión
```

## Notas

- RISK-020: "hoy" se evalúa en America/La_Paz; probar el borde 2026-04-05T23:30-04:00.
