---
id: TC-PLANNING-CLOSE-007
title: "Tras el cierre, las conciliadas sin extracto se listan por su marca y coinciden con el snapshot"
spec: planning/month-closing
related_specs: ["transactions/reconciliation"]
requirement: "Cuentas conciliadas sin extracto en el cierre"
scenario: "Seguimiento después del cierre"
requirement_status: confirmed
fr: [FR-PLANNING-004, FR-TRANSACTIONS-030]
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
tags: ["snapshot", "without-statement", "follow-up"]
error_code: null
preconditions:
  - "Periodo \"2026-10\" (del 2026-10-01 al 2026-10-31) ACTIVE y terminado; política de cierre por defecto"
  - "FixedClock 2026-11-03T12:00:00-04:00 (America/La_Paz)"
  - "\"2026-10\" cerrado como en TC-PLANNING-CLOSE-006 (snapshot 1 con C1 sin extracto)"
input:
  query: "systemFlag=RECONCILED_WITHOUT_STATEMENT&dateFrom=2026-10-01&dateTo=2026-10-31"
steps:
  - "GET W/transactions con el filtro de la marca y el rango de octubre"
  - "GET close-snapshots/1"
expected_result:
  - "El listado devuelve C1 de \"Caja BOB\" (80.00 BOB)"
  - "El conjunto coincide con reconciledWithoutStatementTransactionIds del snapshot 1"
created: 2026-10-08
updated: 2026-10-08
---

# TC-PLANNING-CLOSE-007 — Tras el cierre, las conciliadas sin extracto se listan por su marca y coinciden con el snapshot

## Intención

Decisión del owner docs/33 D111: debe haber un modo de listar y filtrar después lo conciliado sin extracto.

## Escenario

```gherkin
Dado "2026-10" cerrado con un gasto conciliado sin extracto
Cuando el usuario filtra octubre por la marca "conciliada sin extracto"
Entonces obtiene el mismo gasto que lista el snapshot
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
