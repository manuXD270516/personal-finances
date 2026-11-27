---
id: TC-TRANSACTIONS-QUICK-008
title: "Activar Deshacer dos veces produce una sola anulación sin errores"
spec: transactions/transaction-recording
related_specs: ["ledger/journal-posting"]
requirement: "Deshacer un registro desde el aviso"
scenario: "Doble activación de Deshacer"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-009","FR-TRANSACTIONS-010"]
nfr: []
invariants: ["INV-008"]
priority: critical
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/quick-capture.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["quick-capture","void","idempotency"]
error_code: null
preconditions:
  - "el aviso del gasto de 45.00 BOB visible"
input: {}
steps:
  - "el usuario hace doble clic en \"Deshacer\""
expected_result:
  - "se envía una sola solicitud de anulación (o dos con la misma Idempotency-Key)"
  - "existe una sola reversa"
  - "el aviso no muestra INVALID_STATUS_TRANSITION ni ningún otro error"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-008 — Activar Deshacer dos veces produce una sola anulación sin errores

## Intención

Evita dobles anulaciones o errores visibles por un doble toque, frecuente en el teléfono.

## Escenario

```gherkin
Dado el aviso del gasto de 45.00 BOB visible
Cuando el usuario hace doble clic en "Deshacer"
Entonces se envía una sola solicitud de anulación (o dos con la misma Idempotency-Key)
  Y existe una sola reversa
  Y el aviso no muestra INVALID_STATUS_TRANSITION ni ningún otro error
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
