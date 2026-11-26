---
id: TC-TRANSACTIONS-QUICK-011
title: "La cuenta indicada en el enlace tiene prioridad sobre la recordada"
spec: transactions/transaction-recording
related_specs: []
requirement: "Cuenta recordada en el dispositivo"
scenario: "Cuenta indicada en el enlace"
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
  - "la cuenta \"Caja USD\" activa"
input: {}
steps:
  - "el usuario pulsa \"Registrar movimiento\" en el detalle de \"Caja USD\""
expected_result:
  - "el alta se abre con \"Caja USD\" preseleccionada"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-011 — La cuenta indicada en el enlace tiene prioridad sobre la recordada

## Intención

Mantiene el comportamiento de los accesos contextuales (?cuenta=) frente a la memoria del dispositivo.

## Escenario

```gherkin
Dado la cuenta recordada es "Banco BOB"
  Y la cuenta "Caja USD" activa
Cuando el usuario pulsa "Registrar movimiento" en el detalle de "Caja USD"
Entonces el alta se abre con "Caja USD" preseleccionada
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
