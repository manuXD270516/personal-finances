---
id: TC-LEDGER-PERIOD-001
title: Se rechazan los asientos con fecha en un periodo bloqueado
spec: ledger/journal-posting
related_specs: [planning/month-closing, planning/financial-periods]
requirement: Los periodos bloqueados rechazan asientos
scenario: Asiento con fecha en un periodo bloqueado
requirement_status: confirmed
fr: [FR-LEDGER-011, FR-PLANNING-005]
nfr: []
invariants: [INV-015]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: [period-closing]
error_code: PERIOD_CLOSED
preconditions:
- El periodo 2026-08-01..2026-08-31 está bloqueado mediante LedgerPeriodLockPort (en Phase 1 el test lo bloquea directamente; en Phase 2 lo hará Planning al cerrar el mes)
- El periodo de septiembre de 2026 no está bloqueado
- Bank A (BOB) con saldo 1000.00 BOB
input:
- entry: EXPENSE:BOB +45.00 / Bank A -45.00
  currency: BOB
  date: '2026-08-15'
- entry: EXPENSE:BOB +45.00 / Bank A -45.00
  currency: BOB
  date: '2026-09-01'
- reverse: asiento de 120.00 BOB del 2026-07-20 (EXPENSE:BOB / Efectivo BOB)
  reversal_date: '2026-08-10'
steps:
- Registrar el asiento con fecha 2026-08-15
- Registrar el asiento con fecha 2026-09-01
- Revertir el asiento indicado con fecha 2026-08-10
expected_result:
- El asiento del 2026-08-15 se rechaza con PERIOD_CLOSED y no se persiste nada (ni asiento, ni postings, ni evento)
- El asiento del 2026-09-01 se acepta
- Saldo de Bank A = 955.00 BOB
- La reversa fechada 2026-08-10 se rechaza con PERIOD_CLOSED
- Los saldos al 2026-08-31 no cambian
created: 2026-10-01
updated: 2026-10-02
---

# TC-LEDGER-PERIOD-001 — Se rechazan los asientos con fecha en un periodo bloqueado

## Intención

Los meses cerrados no pueden cambiar silenciosamente (INV-015). El rechazo vive en el ledger desde Phase 1 aunque el bloqueo lo escriba Planning en Phase 2; las correcciones pasan por una reapertura auditada o por un ajuste en un periodo abierto.

## Escenario

```gherkin
Dado que el periodo "2026-08-01..2026-08-31" está bloqueado
  Y que "Bank A" tiene un saldo de 1000.00 BOB
Cuando se registra un asiento de gasto de 45.00 BOB con fecha 2026-08-15
Entonces se rechaza con el código "PERIOD_CLOSED"
  Y los saldos al 2026-08-31 no cambian
Cuando se registra el mismo gasto con fecha 2026-09-01
Entonces se acepta y "Bank A" queda en 955.00 BOB
```

## Notas

- La barrera de base de datos (trigger BEFORE INSERT, SQLSTATE PF004) se verifica en TC-LEDGER-PERIOD-002.
- Límite: las fechas son fechas de negocio en la zona horaria del workspace (America/La_Paz).
