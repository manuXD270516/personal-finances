---
id: TC-TRANSACTIONS-QUICK-010
title: "La siguiente alta en el mismo dispositivo preselecciona la última cuenta del workspace"
spec: transactions/transaction-recording
related_specs: []
requirement: "Cuenta recordada en el dispositivo"
scenario: "Siguiente alta en el mismo dispositivo"
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
  - "un EDITOR con dos workspaces"
  - "un gasto de 45.00 BOB registrado en \"Banco BOB\" del primer workspace desde el alta"
input: {}
steps:
  - "el usuario vuelve a abrir el alta en el primer workspace"
  - "cambia al segundo workspace y abre el alta"
expected_result:
  - "en el primero \"Banco BOB\" está preseleccionada"
  - "en el segundo ninguna cuenta está preseleccionada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-010 — La siguiente alta en el mismo dispositivo preselecciona la última cuenta del workspace

## Intención

Verifica D510: la cuenta se recuerda por usuario y workspace en el dispositivo.

## Escenario

```gherkin
Dado un EDITOR con dos workspaces
  Y un gasto de 45.00 BOB registrado en "Banco BOB" del primer workspace desde el alta
Cuando el usuario vuelve a abrir el alta en el primer workspace
  Y cambia al segundo workspace y abre el alta
Entonces en el primero "Banco BOB" está preseleccionada
  Y en el segundo ninguna cuenta está preseleccionada
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
