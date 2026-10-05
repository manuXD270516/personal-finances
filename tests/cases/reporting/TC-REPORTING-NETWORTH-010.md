---
id: TC-REPORTING-NETWORTH-010
title: "Cada punto considera las cuentas con saldo en esa fecha"
spec: reporting/net-worth
related_specs: ["accounts/account-management"]
requirement: "Cuentas consideradas en cada fecha"
scenario: "Cuenta archivada con saldo histórico"
requirement_status: provisional
fr: [FR-REPORTING-006, FR-ACCOUNTS-011]
nfr: []
invariants: [INV-022]
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["net-worth", "accounts"]
error_code: null
preconditions:
  - "\"Caja vieja\" con 300.00 BOB al 2026-01-31, vaciada y archivada en febrero"
  - "\"Banco nuevo\" abierta el 2026-02-10 con 500.00 BOB"
input:
  from: "2026-01"
  to: "2026-02"
steps:
  - "Pedir la serie"
expected_result:
  - "Enero incluye 300.00 BOB de \"Caja vieja\" y nada de \"Banco nuevo\""
  - "Febrero incluye 500.00 BOB de \"Banco nuevo\" y nada de \"Caja vieja\""
created: 2026-10-05
updated: 2026-10-05
---

# TC-REPORTING-NETWORTH-010 — Cada punto considera las cuentas con saldo en esa fecha

## Intención

El estado actual de una cuenta no reescribe su pasado.

## Escenario

```gherkin
Dado "Caja vieja" con 300.00 BOB en enero y archivada en febrero, y "Banco nuevo" abierta en febrero con 500.00 BOB
Cuando se pide la serie de enero y febrero
Entonces enero incluye "Caja vieja" y febrero incluye "Banco nuevo"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
