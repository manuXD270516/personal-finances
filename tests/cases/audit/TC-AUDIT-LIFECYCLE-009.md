---
id: TC-AUDIT-LIFECYCLE-009
title: "El recorrido de una cuenta muestra apertura, archivo, reactivación y cierre"
spec: audit/lifecycle-timeline
related_specs: ["accounts/account-management"]
requirement: "Recorrido de una cuenta"
scenario: "Cuenta abierta, archivada, reactivada y cerrada"
requirement_status: confirmed
fr: ["FR-AUDIT-010","FR-ACCOUNTS-007","FR-ACCOUNTS-004"]
nfr: []
invariants: []
priority: medium
type: api
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/lifecycle.api.test.ts
  - packages/contexts/accounts/src/application/accounts.service.test.ts
  - packages/contexts/accounts/src/domain/account-lifecycle.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["lifecycle","accounts"]
error_code: null
preconditions:
  - "Workspace W1 con \"Bank A\" activa"
input: {"sequence":["OPEN Bank C 500.00 BOB","ARCHIVE motivo sin uso","REACTIVATE","transferir 500.00 BOB a Bank A","CLOSE 2026-03-31"]}
steps:
  - "Ejecutar la secuencia"
  - "GET W/accounts/{id}/lifecycle"
expected_result:
  - "OPEN (∅ → ACTIVE) con el asiento de saldo inicial de 500.00 BOB"
  - "ARCHIVE (ACTIVE → ARCHIVED, reason \"sin uso\")"
  - "REACTIVATE (ARCHIVED → ACTIVE)"
  - "CLOSE (ACTIVE → CLOSED)"
  - "currentState CLOSED; la transferencia no es transición de la cuenta"
created: 2026-10-03
updated: 2026-10-04
---

# TC-AUDIT-LIFECYCLE-009 — El recorrido de una cuenta muestra apertura, archivo, reactivación y cierre

## Intención

Las cuentas también tienen un camino legible (D37), no solo flags de estado.

## Escenario

```gherkin
Dada "Bank C" abierta con 500.00 BOB, archivada, reactivada, vaciada y cerrada
Cuando consulto su recorrido
Entonces veo abrir, archivar, reactivar y cerrar en orden
  Y el estado actual es CLOSED
```

## Notas

