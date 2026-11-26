---
id: TC-TRANSACTIONS-QUICK-002
title: "La edición de una transacción no enfoca ningún campo al cargar"
spec: transactions/transaction-recording
related_specs: []
requirement: "Monto primero en el alta"
scenario: "Editar una transacción"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-002"]
nfr: ["NFR-USAB-102"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["quick-capture","focus"]
error_code: null
preconditions:
  - "un EDITOR con sesión"
  - "un gasto posteado de 120.00 BOB"
input:
  monto: "120.00"
  moneda: "BOB"
steps:
  - "el usuario abre la edición del gasto"
expected_result:
  - "document.activeElement no es ningún campo del formulario"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-002 — La edición de una transacción no enfoca ningún campo al cargar

## Intención

Evita que el foco automático del alta se filtre a la edición, donde el usuario no viene a cambiar el monto.

## Escenario

```gherkin
Dado un EDITOR con sesión
  Y un gasto posteado de 120.00 BOB
Cuando el usuario abre la edición del gasto
Entonces document.activeElement no es ningún campo del formulario
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
