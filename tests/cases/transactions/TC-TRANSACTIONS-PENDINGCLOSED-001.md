---
id: TC-TRANSACTIONS-PENDINGCLOSED-001
title: "Una transacción pending con fecha en un periodo cerrado se rechaza al crearla o moverla"
spec: transactions/transaction-recording
related_specs: ["planning/month-closing"]
requirement: "Transacciones pendientes en periodos cerrados"
scenario: "Registrar una pendiente en un mes cerrado"
requirement_status: confirmed
fr: [FR-PLANNING-005, FR-TRANSACTIONS-001]
nfr: []
invariants: [INV-015]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["pending", "period-closed"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "Periodo \"2026-10\" closed (lock del 2026-10-01 al 2026-10-31); \"2026-11\" active"
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE)"
  - "FixedClock 2026-11-03T12:00:00-04:00 (America/La_Paz)"
input:
  cases: [{"create": {"status": "PENDING", "amount": "60.00", "businessDate": "2026-10-29"}}, {"create": {"status": "PENDING", "amount": "60.00", "businessDate": "2026-11-02"}}, {"patchDateOfPending": {"from": "2026-11-02", "to": "2026-10-30"}}]
steps:
  - "POST transacción pending con fecha 2026-10-29"
  - "POST la misma con fecha 2026-11-02"
  - "PATCH de la pending del 2026-11-02 a 2026-10-30"
expected_result:
  - "2026-10-29: 409 PERIOD_CLOSED; no se crea nada"
  - "2026-11-02: 201, pending sin asiento"
  - "Mover a 2026-10-30: 409 PERIOD_CLOSED; conserva la fecha 2026-11-02"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-PENDINGCLOSED-001 — Una transacción pending con fecha en un periodo cerrado se rechaza al crearla o moverla

## Intención

Decisión del owner docs/33 D69 (P-A12): una pending en un periodo cerrado nunca podría postearse sin reabrirlo; se rechaza para no dejar transacciones inconsistentes.

## Escenario

```gherkin
Dado "2026-10" cerrado
Cuando el usuario registra un gasto pending de 60.00 BOB con fecha 2026-10-29
Entonces se rechaza con "PERIOD_CLOSED"
  Y con fecha 2026-11-02 se acepta
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
