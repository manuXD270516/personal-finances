---
id: TC-TRANSACTIONS-RECONCILIATION-019
title: "Una sesión posterior coteja contra el extracto las conciliadas sin extracto que cubre"
spec: transactions/reconciliation
related_specs: ["audit/lifecycle-timeline"]
requirement: "Cotejo posterior de las conciliadas sin extracto"
scenario: "Sesión que coteja un gasto conciliado sin extracto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-030, FR-AUDIT-010]
nfr: []
invariants: [INV-029, INV-033]
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - packages/contexts/transactions/src/domain/transaction.test.ts
status: automated
regression_suite: true
phase: 2
tags: ["without-statement", "session", "verification"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Gasto G2 de 45.90 BOB del 2026-03-20 conciliado sin extracto"
  - "Gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "Sesión de \"Bank A\" al 2026-03-31 por 3304.10 BOB en curso"
input:
  statementBalance: "3304.10"
  expectedClearedBalance: "3304.10"
steps:
  - "Consultar la diferencia de la sesión"
  - "Finalizar la sesión"
  - "Consultar G2, su recorrido y reconciliation_item"
expected_result:
  - "Saldo confirmado 3304.10 BOB (1000.00 − 150.00 + 2500.00 − 45.90; G2 ya reconciled cuenta) y diferencia 0.00 BOB"
  - "G1 e I1 RECONCILED modo STATEMENT; G2 sigue RECONCILED, ahora modo STATEMENT, sin systemFlags"
  - "reconciliation_item de G2 con verified_without_statement = true"
  - "Recorrido de G2: anotación RECONCILIATION_VERIFIED con la sesión, sin transición nueva"
  - "G3 (posterior al extracto) sin cambios; asientos y saldo contable de \"Bank A\" (3104.10 BOB) sin cambios"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-019 — Una sesión posterior coteja contra el extracto las conciliadas sin extracto que cubre

## Intención

Decisión docs/33 D74/D111: la revisión natural de una conciliada sin extracto es cotejarla contra un extracto posterior; sin esto la marca "pendiente de revisión" no se resolvería nunca.

## Escenario

```gherkin
Dado un gasto de 45.90 BOB conciliado sin extracto en "Bank A"
Cuando se finaliza la sesión al 2026-03-31 por 3304.10 BOB con diferencia 0.00 BOB
Entonces el gasto pasa a modo contra extracto sin la marca
  Y el ledger no cambia
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
