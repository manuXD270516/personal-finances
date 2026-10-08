---
id: TC-TRANSACTIONS-RECONCILIATION-005
title: "Confirmar dentro de la sesión cambia el saldo confirmado sin tocar el ledger"
spec: transactions/reconciliation
related_specs: []
requirement: "Confirmar transacciones dentro de la sesión"
scenario: "Confirmar el gasto pendiente de confirmar"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-029, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-033, INV-023]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/reconciliation.api.test.ts
  - apps/web/src/ui/reconciliation/reconciliation.test.tsx
  - packages/contexts/transactions/src/application/reconciliations.service.test.ts
  - packages/contexts/transactions/src/domain/reconciliation.test.ts
  - tests/e2e/specs/reconciliation.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ["reconciliation", "cleared"]
error_code: null
preconditions:
  - "Cuenta \"Bank A\" (ASSET, BOB, ACTIVE) con saldo inicial 1000.00 BOB al 2026-02-28"
  - "Gasto G1 cleared de 150.00 BOB del 2026-03-05; ingreso I1 cleared de 2500.00 BOB del 2026-03-10"
  - "Gasto G2 posted de 45.90 BOB del 2026-03-20; gasto G3 cleared de 200.00 BOB del 2026-04-02"
  - "FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz)"
  - "Sesión de \"Bank A\" al 2026-03-31 por 3304.10 BOB"
input:
  - "{\"items\":[{\"id\":\"G2\",\"version\":1}],\"cleared\":true}"
  - "{\"items\":[{\"id\":\"G4 (posted, 2026-04-03)\",\"version\":1}],\"cleared\":true}"
steps:
  - "POST W/reconciliations/{id}/cleared con G2"
  - "Intentar con G4"
expected_result:
  - "G2 cleared; saldo confirmado 3304.10 BOB; diferencia 0.00 BOB"
  - "Número de asientos y saldo contable sin cambios"
  - "G4: 400 VALIDATION_FAILED; sigue posted"
  - "Se publica TransactionCleared.v1 para G2"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-005 — Confirmar dentro de la sesión cambia el saldo confirmado sin tocar el ledger

## Intención

Confirmar en la sesión es el mismo CLEAR de Phase 1 (decisión 2 del design), acotado a la cuenta y a la fecha del extracto.

## Escenario

```gherkin
Dado la sesión de "Bank A" al 2026-03-31 por 3304.10 BOB
Cuando el usuario confirma el gasto posted de 45.90 BOB del 2026-03-20
Entonces el gasto queda cleared y la diferencia pasa a 0.00 BOB
  Y el saldo contable de "Bank A" no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
