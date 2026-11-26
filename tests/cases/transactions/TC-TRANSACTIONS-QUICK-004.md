---
id: TC-TRANSACTIONS-QUICK-004
title: "Registrar e ir al detalle abre el detalle del gasto con el aviso de registrada"
spec: transactions/transaction-recording
related_specs: []
requirement: "Registrar y seguir registrando"
scenario: "Registrar e ir al detalle"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-001"]
nfr: ["NFR-USAB-007"]
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
tags: ["quick-capture"]
error_code: null
preconditions:
  - "un EDITOR con sesión"
  - "\"Banco BOB\" activa con saldo 1000.00 BOB"
input:
  monto: "45.00"
  moneda: "BOB"
steps:
  - "el usuario registra 45.00 BOB con \"Registrar e ir al detalle\""
expected_result:
  - "la URL es la del detalle del gasto con ?aviso=registrada"
  - "el detalle muestra el gasto de Bs 45,00 y el saldo de \"Banco BOB\" es 955.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-004 — Registrar e ir al detalle abre el detalle del gasto con el aviso de registrada

## Intención

Conserva el comportamiento anterior como acción secundaria para quien quiere revisar el detalle.

## Escenario

```gherkin
Dado un EDITOR con sesión
  Y "Banco BOB" activa con saldo 1000.00 BOB
Cuando el usuario registra 45.00 BOB con "Registrar e ir al detalle"
Entonces la URL es la del detalle del gasto con ?aviso=registrada
  Y el detalle muestra el gasto de Bs 45,00 y el saldo de "Banco BOB" es 955.00 BOB
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
