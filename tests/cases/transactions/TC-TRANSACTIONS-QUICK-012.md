---
id: TC-TRANSACTIONS-QUICK-012
title: "Una cuenta recordada que se archivó no se preselecciona"
spec: transactions/transaction-recording
related_specs: ["accounts/account-management"]
requirement: "Cuenta recordada en el dispositivo"
scenario: "Cuenta recordada archivada"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-007"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/transactions/last-account.test.ts
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["quick-capture","local-storage"]
error_code: null
preconditions:
  - "la cuenta recordada es \"Banco BOB\""
  - "\"Banco BOB\" archivada después"
input: {}
steps:
  - "el usuario abre el alta"
expected_result:
  - "ninguna cuenta está preseleccionada"
  - "el alta funciona igual si localStorage lanza una excepción (navegación privada)"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-012 — Una cuenta recordada que se archivó no se preselecciona

## Intención

Evita ofrecer una cuenta que no admite movimientos y comprueba que la falta de almacenamiento no rompe el alta.

## Escenario

```gherkin
Dado la cuenta recordada es "Banco BOB"
  Y "Banco BOB" archivada después
Cuando el usuario abre el alta
Entonces ninguna cuenta está preseleccionada
  Y el alta funciona igual si localStorage lanza una excepción (navegación privada)
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
