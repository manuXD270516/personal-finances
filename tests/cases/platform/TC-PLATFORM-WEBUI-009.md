---
id: TC-PLATFORM-WEBUI-009
title: "Escape cierra el diálogo de anulación y devuelve el foco a Anular"
spec: platform/web-interface
related_specs: ["transactions/transaction-recording"]
requirement: "Confirmación de acciones irreversibles en un diálogo modal"
scenario: "Cancelar con Escape"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-009"]
nfr: ["NFR-USAB-102"]
invariants: ["INV-008"]
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["a11y","dialog","focus"]
error_code: null
preconditions:
  - "el diálogo de anulación abierto sobre un gasto posteado de 60.00 BOB en \"Banco BOB\" (saldo 940.00 BOB)"
input:
  tecla: "Escape"
steps:
  - "el usuario pulsa Escape"
expected_result:
  - "el diálogo se cierra"
  - "el foco vuelve al botón \"Anular\""
  - "el gasto sigue posteado y el saldo de \"Banco BOB\" sigue en 940.00 BOB"
  - "onCancel se ejecutó una sola vez"
created: 2026-11-25
updated: 2026-11-25
---

# TC-PLATFORM-WEBUI-009 — Escape cierra el diálogo de anulación y devuelve el foco a Anular

## Intención

Cierra la brecha de ConfirmPanel, que al cancelar se desmontaba sin devolver el foco, y comprueba que cancelar no tiene efecto contable.

## Escenario

```gherkin
Dado el diálogo de anulación abierto sobre un gasto posteado de 60.00 BOB en "Banco BOB" (saldo 940.00 BOB)
Cuando el usuario pulsa Escape
Entonces el diálogo se cierra
  Y el foco vuelve al botón "Anular"
  Y el gasto sigue posteado y el saldo de "Banco BOB" sigue en 940.00 BOB
  Y onCancel se ejecutó una sola vez
```

## Notas

- Change `refine-web-accessibility-foundations` (lote L1, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
