---
id: TC-ACCOUNTS-OPENING-003
title: "Reintentar la creación de una cuenta con la misma clave de idempotencia no duplica cuenta ni asiento"
spec: accounts/account-management
related_specs: ["platform/api-conventions"]
requirement: "Apertura de cuenta idempotente"
scenario: "Reintento tras un corte de red"
requirement_status: confirmed
fr: [FR-ACCOUNTS-004]
nfr: [NFR-REL-007]
invariants: [INV-027]
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 1
tags: ["accounts", "idempotency"]
error_code: "IDEMPOTENCY_KEY_REUSED"
preconditions: ["Usuario EDITOR en W1"]
input:
  key: "K-ACC-001"
  first: {name: "Bank F", type: "BANK", currency: "BOB", opening_amount: "500.00", opening_date: "2026-01-01"}
  conflicting: {name: "Bank F", type: "BANK", currency: "BOB", opening_amount: "600.00", opening_date: "2026-01-01"}
steps:
  - "POST /accounts con Idempotency-Key K-ACC-001 y el body first"
  - "Repetir exactamente el mismo POST"
  - "POST con la misma clave y el body conflicting"
expected_result:
  - "Las dos primeras respuestas son 201 con el mismo id; la segunda trae Idempotent-Replayed: true"
  - "Existe una sola cuenta Bank F con saldo 500.00 BOB y un solo asiento de apertura"
  - "El tercer POST responde 422 IDEMPOTENCY_KEY_REUSED"
created: 2026-10-02
updated: 2026-10-02
---

# TC-ACCOUNTS-OPENING-003 — Reintentar la creación de una cuenta con la misma clave de idempotencia no duplica cuenta ni asiento

## Intención

INV-027: un reintento de red no debe duplicar dinero de apertura.

## Escenario

```gherkin
Cuando el usuario envía dos veces la creación de "Bank F" con 500.00 BOB y la misma clave
Entonces existe una sola "Bank F" con 500.00 BOB y un solo asiento de apertura
```
