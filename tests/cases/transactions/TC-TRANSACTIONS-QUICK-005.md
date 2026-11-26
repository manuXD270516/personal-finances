---
id: TC-TRANSACTIONS-QUICK-005
title: "Ver en el aviso abre el detalle del gasto y el aviso deja de mostrarse"
spec: transactions/transaction-recording
related_specs: []
requirement: "Registrar y seguir registrando"
scenario: "Ver desde el aviso"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-001"]
nfr: ["NFR-USAB-102"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["quick-capture","notices"]
error_code: null
preconditions:
  - "el aviso del gasto de 45.00 BOB visible en el alta"
input: {}
steps:
  - "el usuario pulsa \"Ver\" en el aviso"
expected_result:
  - "se abre el detalle del gasto de 45.00 BOB"
  - "la región de avisos de la nueva página está vacía"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-005 — Ver en el aviso abre el detalle del gasto y el aviso deja de mostrarse

## Intención

Comprueba que "Ver" navega al detalle y descarta el aviso, sin guardarlo para la página siguiente.

## Escenario

```gherkin
Dado el aviso del gasto de 45.00 BOB visible en el alta
Cuando el usuario pulsa "Ver" en el aviso
Entonces se abre el detalle del gasto de 45.00 BOB
  Y la región de avisos de la nueva página está vacía
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
