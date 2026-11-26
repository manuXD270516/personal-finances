---
id: TC-TRANSACTIONS-QUICK-006
title: "Deshacer desde el aviso anula el gasto con reversa y devuelve el saldo a 1000.00 BOB"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting"]
requirement: "Deshacer un registro desde el aviso"
scenario: "Deshacer un gasto"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-009","FR-LEDGER-005"]
nfr: ["NFR-USAB-009"]
invariants: ["INV-008"]
priority: critical
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - apps/web/src/ui/common/notices-state.test.ts
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["quick-capture","money","void","regression"]
error_code: null
preconditions:
  - "\"Banco BOB\" con saldo 955.00 BOB tras registrar un gasto de 45.00 BOB desde el alta"
  - "el aviso del registro visible"
input:
  monto: "45.00"
  moneda: "BOB"
steps:
  - "el usuario pulsa \"Deshacer\" en el aviso"
expected_result:
  - "la solicitud es POST .../void con If-Match de la versión registrada, Idempotency-Key propia y el motivo \"Deshecho desde el aviso de registro\""
  - "el gasto queda VOIDED y existe la reversa de su asiento, que suma 0.00 BOB con el original"
  - "el saldo de \"Banco BOB\" es 1000.00 BOB"
  - "el aviso dice \"Registro anulado\" y ya no tiene \"Deshacer\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-006 — Deshacer desde el aviso anula el gasto con reversa y devuelve el saldo a 1000.00 BOB

## Intención

Verifica D508 y la regla financiera: deshacer es anular con reversa, nunca borrar (FR-TRANSACTIONS-009, INV-008).

## Escenario

```gherkin
Dado "Banco BOB" con saldo 955.00 BOB tras registrar un gasto de 45.00 BOB desde el alta
  Y el aviso del registro visible
Cuando el usuario pulsa "Deshacer" en el aviso
Entonces la solicitud es POST .../void con If-Match de la versión registrada, Idempotency-Key propia y el motivo "Deshecho desde el aviso de registro"
  Y el gasto queda VOIDED y existe la reversa de su asiento, que suma 0.00 BOB con el original
  Y el saldo de "Banco BOB" es 1000.00 BOB
  Y el aviso dice "Registro anulado" y ya no tiene "Deshacer"
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
