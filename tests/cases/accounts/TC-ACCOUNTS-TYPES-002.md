---
id: TC-ACCOUNTS-TYPES-002
title: "El tipo de una cuenta no puede cambiarse después de crearla"
spec: accounts/account-management
related_specs: []
requirement: "Tipo de cuenta inmutable"
scenario: "Intento de convertir un banco en tarjeta"
requirement_status: confirmed
fr: [FR-ACCOUNTS-003]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/domain/account.test.ts
  - apps/api/test/api/accounts.api.test.ts
status: automated
regression_suite: false
phase: 1
tags: ["accounts", "account-type"]
error_code: "VALIDATION_FAILED"
preconditions: ["Minimal Seed: Bank A (bank, BOB) con saldo 1000.00"]
input:
  request: "PATCH /accounts/<Bank A> con body {\"type\": \"CREDIT_CARD\"}"
steps: ["Enviar el PATCH con If-Match vigente"]
expected_result:
  - "Respuesta 400 con code VALIDATION_FAILED"
  - "Bank A sigue con tipo bank, naturaleza ASSET y saldo 1000.00 BOB"
  - "No se escribe auditoría ni evento"
created: 2026-10-02
updated: 2026-10-03
---

# TC-ACCOUNTS-TYPES-002 — El tipo de una cuenta no puede cambiarse después de crearla

## Intención

Cambiar el tipo cambiaría la naturaleza y el signo de todo el historial (docs/04 §3.2).

## Escenario

```gherkin
Dado "Bank A" de tipo bank con 1000.00 BOB
Cuando el usuario intenta cambiar su tipo a credit_card
Entonces se rechaza con VALIDATION_FAILED
```
