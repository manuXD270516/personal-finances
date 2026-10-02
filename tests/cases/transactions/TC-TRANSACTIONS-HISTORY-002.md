---
id: TC-TRANSACTIONS-HISTORY-002
title: Un VIEWER ve el historial de una transacción que puede ver
spec: transactions/transaction-recording
related_specs: []
requirement: Historial de cambios de la transacción
scenario: VIEWER consulta el historial de una transacción
requirement_status: confirmed
fr:
- FR-TRANSACTIONS-014
- FR-AUDIT-004
nfr: []
invariants:
- INV-029
priority: high
type: security
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 1
tags:
- audit
- history
- rbac
error_code: null
preconditions:
- W1 con un EDITOR y un VIEWER
- Gasto de 120.00 BOB editado por el EDITOR a 102.00 BOB
input:
  role: VIEWER
  edit:
    from: "120.00"
    to: "102.00"
    currency: BOB
steps:
- Como VIEWER consultar el historial de la transacción
- Como VIEWER intentar consultar el historial de otra entidad y de otro workspace
expected_result:
- El VIEWER obtiene el historial con actor, fecha y cambio 120.00 BOB -> 102.00 BOB
- No aparecen registros de otras entidades ni de otros workspaces
created: '2026-10-02'
updated: '2026-10-02'
---

# TC-TRANSACTIONS-HISTORY-002 — Un VIEWER ve el historial de una transacción que puede ver

## Intención

Decisión del owner 2026-10-02 (D28, docs/31).

## Escenario

```gherkin
Dado un gasto de 120.00 BOB editado a 102.00 BOB por un EDITOR
Cuando un VIEWER abre su detalle
Entonces ve el historial con el cambio de 120.00 BOB a 102.00 BOB
Y no ve registros de otras entidades
```
