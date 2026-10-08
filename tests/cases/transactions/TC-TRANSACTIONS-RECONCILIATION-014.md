---
id: TC-TRANSACTIONS-RECONCILIATION-014
title: "El marcado directo con modo explícito deja la transacción conciliada sin extracto"
spec: transactions/reconciliation
related_specs: []
requirement: "Marcar una transacción como reconciliada"
scenario: "Marcado directo como conciliada sin extracto"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-006, FR-TRANSACTIONS-030]
nfr: []
invariants: [INV-023, INV-033]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["reconciled", "modified", "without-statement"]
error_code: null
preconditions:
  - "Gasto G1 cleared de 150.00 BOB en \"Bank A\" (saldo contable 850.00 BOB), versión vigente conocida"
input:
  patch: {"status": "RECONCILED", "reconciliationMode": "WITHOUT_STATEMENT"}
steps:
  - "PATCH W/transactions/{id} con status RECONCILED, reconciliationMode WITHOUT_STATEMENT e If-Match vigente"
  - "GET W/transactions/{id}"
expected_result:
  - "200: status RECONCILED, reconciliationMode WITHOUT_STATEMENT, systemFlags [RECONCILED_WITHOUT_STATEMENT]"
  - "Mismo único asiento activo; saldo de \"Bank A\" 850.00 BOB"
  - "No existe el código RECONCILIATION_SESSION_REQUIRED en la respuesta ni en el catálogo"
created: 2026-10-08
updated: 2026-10-08
---

# TC-TRANSACTIONS-RECONCILIATION-014 — El marcado directo con modo explícito deja la transacción conciliada sin extracto

## Intención

Requirement MODIFIED por la decisión del owner docs/33 D74 (cambia la recomendación original): el marcado directo se conserva como modo explícito "conciliada sin extracto". Reemplaza la expectativa de TC-TRANSACTIONS-RECONCILED-001 al implementarse (el request agrega el modo).

## Escenario

```gherkin
Dado un gasto cleared de 150.00 BOB
Cuando el usuario lo marca directamente como reconciled indicando el modo "conciliada sin extracto"
Entonces queda reconciled en modo sin extracto con la marca de seguimiento
  Y el saldo de la cuenta no cambia
```

## Notas

- Datos ficticios; montos como strings decimales; fechas fijas con `FixedClock` en America/La_Paz.
