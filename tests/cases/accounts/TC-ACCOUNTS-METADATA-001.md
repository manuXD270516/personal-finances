---
id: TC-ACCOUNTS-METADATA-001
title: "Editar metadatos de una cuenta no toca el ledger, se audita y respeta la concurrencia optimista"
spec: accounts/account-management
related_specs: ["audit/audit-trail"]
requirement: "Edición de metadatos sin efecto contable"
scenario: "Renombrar y cambiar color"
requirement_status: confirmed
fr: [FR-ACCOUNTS-009]
nfr: []
invariants: [INV-029]
priority: high
type: integration
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/application/accounts.service.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "metadata", "audit"]
error_code: "PRECONDITION_FAILED"
preconditions: ["Bank A (bank, BOB) con saldo 925.00 BOB, version 3", "Dos usuarios EDITOR de W1"]
input:
  update: {name: "Banco principal", color: "#1E88E5", notes: "Cuenta sueldo", liquidity: "LIQUID", includeInNetWorth: true}
  if_match: "version 3"
steps:
  - "Usuario 1 envía el PATCH con If-Match version 3"
  - "Usuario 2 envía otro PATCH con If-Match version 3"
  - "Contar asientos y leer auditoría y outbox"
expected_result:
  - "La primera edición responde 200 con version 4; el saldo sigue en 925.00 BOB"
  - "No se crea, modifica ni revierte ningún asiento"
  - "Existe un registro de auditoría con before \"Bank A\" y after \"Banco principal\" y se emite accounts.AccountUpdated.v1 con changedFields name, color, notes"
  - "La segunda edición se rechaza con PRECONDITION_FAILED (412)"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-METADATA-001 — Editar metadatos de una cuenta no toca el ledger, se audita y respeta la concurrencia optimista

## Intención

FR-ACCOUNTS-009: separar presentación de contabilidad; la edición concurrente no debe pisar cambios.

## Escenario

```gherkin
Dado "Bank A" con 925.00 BOB
Cuando el usuario la renombra a "Banco principal" y cambia su color
Entonces el saldo sigue en 925.00 BOB y no hay asientos nuevos
  Y la auditoría muestra el nombre anterior y el nuevo
```

## Notas

- `notes` aparece en `changedFields` del evento pero su valor nunca viaja en el payload (design.md §Contratos).
