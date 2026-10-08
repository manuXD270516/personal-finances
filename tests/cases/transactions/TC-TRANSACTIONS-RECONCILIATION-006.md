---
id: TC-TRANSACTIONS-RECONCILIATION-006
title: "Finalizar con diferencia cero reconcilia lo confirmado de forma atómica"
spec: transactions/reconciliation
related_specs: ["audit/audit-trail", "audit/lifecycle-timeline"]
requirement: "Finalizar una sesión con diferencia cero"
scenario: "Finalizar la reconciliación de marzo"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-AUDIT-001]
nfr: []
invariants: [INV-023, INV-029, INV-033]
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ["reconciliation", "atomic"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión de \"Bank A\" al 2026-03-31 por 3350.00 BOB, versión 1"
input:
  ifMatch: "1"
steps:
  - "POST W/reconciliations/{id}/complete"
  - "Repetir en un estado limpio inyectando una falla en AuditPort"
expected_result:
  - "G1 e I1 reconciled y vinculados a la sesión (reconciliation_item)"
  - "Sesión COMPLETED con cleared_balance 3350.00 y difference 0.00"
  - "G2 sigue posted y G3 sigue cleared"
  - "Saldo contable 3104.10 BOB y número de asientos sin cambios"
  - "ReconciliationCompleted.v1 publicado una vez"
  - "Con falla de auditoría: sesión IN_PROGRESS y nadie reconciled"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-006 — Finalizar con diferencia cero reconcilia lo confirmado de forma atómica

## Intención

FR-TRANSACTIONS-030 + INV-029: reconciliar es todo o nada con su auditoría y sus transiciones.

## Escenario

```gherkin
Dado la sesión de "Bank A" con diferencia 0.00 BOB
Cuando el usuario la finaliza
Entonces el gasto de 150.00 BOB y el ingreso de 2500.00 BOB quedan reconciled
  Y la sesión queda COMPLETED con saldo confirmado 3350.00 BOB
  Y el saldo contable sigue en 3104.10 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
