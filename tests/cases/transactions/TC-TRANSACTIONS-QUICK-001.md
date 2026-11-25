---
id: TC-TRANSACTIONS-QUICK-001
title: "A 360 px el alta empieza por el monto con foco, teclado decimal y tecla siguiente"
spec: transactions/transaction-recording
related_specs: []
requirement: "Monto primero en el alta"
scenario: "Abrir el alta en el teléfono"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-002"]
nfr: ["NFR-USAB-006","NFR-USAB-007"]
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["quick-capture","mobile","focus"]
error_code: null
preconditions:
  - "un EDITOR con sesión (es-BO)"
  - "viewport de 360 x 800"
input: {}
steps:
  - "el usuario abre /transacciones/nueva"
expected_result:
  - "el primer control del formulario es el monto y tiene el foco"
  - "el monto tiene inputmode=\"decimal\" y enterkeyhint=\"next\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-001 — A 360 px el alta empieza por el monto con foco, teclado decimal y tecla siguiente

## Intención

Verifica M-03: en el teléfono el alta empezaba eligiendo una cuenta y no con el número (docs/28 §4.1 pide monto primero).

## Escenario

```gherkin
Dado un EDITOR con sesión (es-BO)
  Y viewport de 360 x 800
Cuando el usuario abre /transacciones/nueva
Entonces el primer control del formulario es el monto y tiene el foco
  Y el monto tiene inputmode="decimal" y enterkeyhint="next"
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
