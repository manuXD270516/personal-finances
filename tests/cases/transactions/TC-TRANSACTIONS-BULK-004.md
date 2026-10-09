---
id: TC-TRANSACTIONS-BULK-004
title: "La edición masiva no acepta cambios financieros ni toca el ledger"
spec: transactions/bulk-edit
related_specs: ["ledger/journal-posting"]
requirement: "La edición masiva no cambia montos, cuentas, fechas ni el ledger"
scenario: "Saldos intactos tras recategorizar"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-TRANSACTIONS-008]
nfr: []
invariants: [INV-033]
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
  - packages/contexts/transactions/src/application/bulk-edit.service.test.ts
  - packages/contexts/transactions/src/domain/bulk-edit.test.ts
status: automated
regression_suite: true
phase: 2
tags: ["bulk-edit", "ledger"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
input:
  - "{\"changes\":{\"categoryId\":\"Hogar\"}}"
  - "{\"changes\":{\"amount\":\"100.00\"}}"
  - "{\"changes\":{\"accountId\":\"Caja BOB\"}}"
  - "{\"changes\":{\"businessDate\":\"2026-03-01\"}}"
steps:
  - "Contar asientos y saldo de \"Bank A\""
  - "Recategorizar T1–T3 en lote"
  - "Enviar lotes con amount, accountId y businessDate"
expected_result:
  - "Tras recategorizar: mismo número de asientos y \"Bank A\" en 2000.00 BOB"
  - "Lotes con campos financieros: 400 VALIDATION_FAILED; nada cambia"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-004 — La edición masiva no acepta cambios financieros ni toca el ledger

## Intención

INV-033: clasificar en lote nunca crea, modifica ni revierte asientos.

## Escenario

```gherkin
Dado "Bank A" con saldo 2000.00 BOB y tres gastos posteados
Cuando el usuario los recategoriza en lote
Entonces el número de asientos no cambia
  Y el saldo de "Bank A" sigue en 2000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
