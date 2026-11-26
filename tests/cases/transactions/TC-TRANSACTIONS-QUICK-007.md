---
id: TC-TRANSACTIONS-QUICK-007
title: "Deshacer con el periodo ya cerrado muestra el error del catálogo y no anula"
spec: transactions/transaction-recording
related_specs: ["planning/financial-periods"]
requirement: "Deshacer un registro desde el aviso"
scenario: "Periodo cerrado entre el registro y el deshacer"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-009"]
nfr: ["NFR-USAB-009"]
invariants: []
priority: critical
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["quick-capture","money","void","period"]
error_code: "PERIOD_CLOSED"
preconditions:
  - "un gasto de 45.00 BOB del 2026-10-31 registrado desde el alta, con \"Banco BOB\" en 955.00 BOB"
  - "el periodo \"2026-10\" cerrado después del registro (por la API, en otra pestaña)"
input:
  monto: "45.00"
  moneda: "BOB"
  fecha: "2026-10-31"
steps:
  - "el usuario pulsa \"Deshacer\" en el aviso"
expected_result:
  - "el aviso muestra el mensaje de PERIOD_CLOSED del catálogo de errores"
  - "el gasto sigue posteado y el saldo de \"Banco BOB\" sigue en 955.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-007 — Deshacer con el periodo ya cerrado muestra el error del catálogo y no anula

## Intención

Comprueba que deshacer respeta los periodos cerrados con el mismo comando de anulación (docs/78 § 9, comportamiento financiero).

## Escenario

```gherkin
Dado un gasto de 45.00 BOB del 2026-10-31 registrado desde el alta, con "Banco BOB" en 955.00 BOB
  Y el periodo "2026-10" cerrado después del registro (por la API, en otra pestaña)
Cuando el usuario pulsa "Deshacer" en el aviso
Entonces el aviso muestra el mensaje de PERIOD_CLOSED del catálogo de errores
  Y el gasto sigue posteado y el saldo de "Banco BOB" sigue en 955.00 BOB
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
