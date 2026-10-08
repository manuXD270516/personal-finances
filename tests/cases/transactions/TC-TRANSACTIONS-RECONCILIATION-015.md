---
id: TC-TRANSACTIONS-RECONCILIATION-015
title: "Des-reconciliar tras completar anota la sesión y respeta periodos cerrados"
spec: transactions/reconciliation
related_specs: ["audit/lifecycle-timeline"]
requirement: "Des-reconciliación explícita y auditada"
scenario: null
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-AUDIT-001]
nfr: []
invariants: [INV-015, INV-029]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["unreconcile", "modified"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión al 2026-03-31 COMPLETED con G1 e I1 reconciled"
input:
  - "{\"transaction\":\"G1\",\"reason\":\"duplicado en extracto\"}"
  - "{\"transaction\":\"I1\",\"reason\":\"x\",\"periodLock\":\"2026-03\"}"
steps:
  - "Des-reconciliar G1 con motivo"
  - "Consultar la sesión y el estado de \"Bank A\" con corte 2026-03-31"
  - "Bloquear 2026-03 y des-reconciliar I1"
expected_result:
  - "G1 cleared; sesión sigue COMPLETED con 3350.00 y muestra G1 des-reconciliado después de completarse"
  - "Estado de \"Bank A\": G1 cuenta como no reconciliado"
  - "I1: 409 PERIOD_CLOSED y sigue reconciled"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-015 — Des-reconciliar tras completar anota la sesión y respeta periodos cerrados

## Intención

Requirement MODIFIED: la des-reconciliación no reescribe el resultado de la sesión y no altera meses cerrados.

## Escenario

```gherkin
Dado el gasto de 150.00 BOB reconciliado en la sesión al 2026-03-31
Cuando el usuario lo des-reconcilia con motivo "duplicado en extracto"
Entonces la sesión sigue COMPLETED y registra la des-reconciliación posterior
  Y el gasto queda cleared
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
