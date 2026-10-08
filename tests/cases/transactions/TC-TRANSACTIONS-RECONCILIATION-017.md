---
id: TC-TRANSACTIONS-RECONCILIATION-017
title: "El marcado directo sin modo explícito o desde un estado no cleared se rechaza sin cambios"
spec: transactions/reconciliation
related_specs: []
requirement: "Conciliación sin extracto"
scenario: "Marcado directo sin indicar el modo"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-023]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["reconciled", "without-statement", "validation"]
error_code: "VALIDATION_FAILED"
preconditions:
  - "Cuenta \"Caja BOB\" (ASSET, BOB, ACTIVE, sin sesiones) con saldo inicial 500.00 BOB"
  - "Gasto C1 de 80.00 BOB del 2026-03-12 en \"Caja BOB\""
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "C1 cleared"
  - "Gasto G2 posted de 45.90 BOB en \"Bank A\""
  - "Usuario VIEWER V1 en el workspace"
input:
  cases: [{"tx": "C1", "patch": {"status": "RECONCILED"}}, {"tx": "C1", "patch": {"status": "RECONCILED", "reconciliationMode": "STATEMENT"}}, {"tx": "G2", "patch": {"status": "RECONCILED", "reconciliationMode": "WITHOUT_STATEMENT"}}, {"tx": "C1", "actor": "V1", "patch": {"status": "RECONCILED", "reconciliationMode": "WITHOUT_STATEMENT"}}]
steps:
  - "Enviar cada PATCH con If-Match vigente"
expected_result:
  - "Sin modo: 422 VALIDATION_FAILED con puntero a reconciliationMode; C1 sigue cleared"
  - "Modo STATEMENT fuera de sesión: 422 VALIDATION_FAILED (el request solo acepta WITHOUT_STATEMENT)"
  - "G2 posted: 409 INVALID_STATUS_TRANSITION; sigue posted"
  - "VIEWER: 403 INSUFFICIENT_ROLE"
  - "Ningún caso escribe auditoría, transición ni outbox"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-017 — El marcado directo sin modo explícito o desde un estado no cleared se rechaza sin cambios

## Intención

Decisión docs/33 D74: el modo debe ser explícito. Protege contra conciliar "por accidente" con el PATCH de Phase 1.

## Escenario

```gherkin
Dado un gasto cleared de 80.00 BOB
Cuando el usuario lo marca reconciled sin indicar el modo
Entonces se rechaza con "VALIDATION_FAILED"
  Y el gasto sigue cleared
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
