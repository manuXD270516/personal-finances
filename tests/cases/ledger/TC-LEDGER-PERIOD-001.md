---
id: TC-LEDGER-PERIOD-001
title: "Se rechazan los asientos con fecha en un periodo cerrado"
spec: ledger/journal-posting
related_specs: ["planning/month-closing", "planning/financial-periods"]
requirement: "Los periodos cerrados rechazan registros"
scenario: null
requirement_status: provisional
fr: [FR-LEDGER-004]
nfr: []
invariants: [INV-015]
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags: ["period-closing"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "El periodo financiero 2026-08 está cerrado"
  - "El periodo financiero 2026-09 está abierto"
  - "Bank A (BOB) con saldo 1000.00"
input:
  - expense: "45.00"
    currency: "BOB"
    date: "2026-08-15"
  - expense: "45.00"
    currency: "BOB"
    date: "2026-09-01"
steps:
  - "Registrar un gasto con fecha 2026-08-15"
  - "Registrar un gasto con fecha 2026-09-01"
expected_result:
  - "El gasto del 2026-08-15 se rechaza con PERIOD_CLOSED y no se persiste nada (ni transacción, ni asiento, ni auditoría de una mutación)"
  - "El gasto del 2026-09-01 se acepta"
  - "Saldo de Bank A = 955.00 BOB"
  - "Los reportes de 2026-08 no cambian"
created: 2026-10-01
updated: 2026-10-01
---

# TC-LEDGER-PERIOD-001 — Se rechazan los asientos con fecha en un periodo cerrado

## Intención

Los meses cerrados no pueden cambiar silenciosamente (INV-015); las correcciones pasan por una reapertura (auditada) o por un ajuste en un periodo abierto.

## Escenario

```gherkin
Dado que el periodo "2026-08" está cerrado
Cuando el usuario registra un gasto de 45.00 BOB con fecha 2026-08-15
Entonces se rechaza con el código "PERIOD_CLOSED"
  Y los totales del periodo "2026-08" no cambian
```

## Notas

- Pregunta abierta (docs/16): si un trigger de base de datos también lo impone; de ser así, agregar a este TC un test de nivel database-integration.
- Límite: las fechas son fechas de negocio en la zona horaria del workspace (America/La_Paz).
