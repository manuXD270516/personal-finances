---
id: TC-TRANSACTIONS-RECONCILIATION-023
title: "Las RECONCILED de Phase 1 se migran como conciliadas sin extracto sin reescribir historia"
spec: transactions/reconciliation
related_specs: []
requirement: "Marcar una transacción como reconciliada"
scenario: "Reconciliada antes de las sesiones"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-007, INV-029]
priority: high
type: integration
level: migration
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["migration", "without-statement"]
error_code: null
preconditions:
  - "Base con el esquema previo a add-reconciliation y un gasto G6 de 60.00 BOB RECONCILED (marcado directo de Phase 1) con su auditoría y transiciones"
input:
  migration: "txn_reconciliation"
steps:
  - "Aplicar la migración expand"
  - "Consultar G6, su recorrido y su auditoría"
  - "Intentar con pf_app un UPDATE que deje status RECONCILED con reconciliation_mode NULL"
expected_result:
  - "G6 sigue RECONCILED con reconciliation_mode WITHOUT_STATEMENT y systemFlags [RECONCILED_WITHOUT_STATEMENT]"
  - "Sin sesión retroactiva ni transiciones o auditorías nuevas; recorrido y versión de G6 iguales"
  - "El CHECK de coherencia estado/modo rechaza el UPDATE"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-023 — Las RECONCILED de Phase 1 se migran como conciliadas sin extracto sin reescribir historia

## Intención

Decisión docs/33 D77: no reescribir historia; las reconciliadas de Phase 1 quedan como sin extracto y marcadas para seguimiento.

## Escenario

```gherkin
Dado un gasto reconciled de Phase 1 sin sesión
Cuando se aplica la migración de add-reconciliation
Entonces se informa como conciliado sin extracto con la marca
  Y su historia no cambia
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
