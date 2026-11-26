---
id: TC-TRANSACTIONS-QUICK-009
title: "Deshacer sigue disponible 10 minutos después del registro"
spec: transactions/transaction-recording
related_specs: []
requirement: "Deshacer un registro desde el aviso"
scenario: "Deshacer varios minutos después"
requirement_status: confirmed
fr: ["FR-TRANSACTIONS-009"]
nfr: ["NFR-USAB-101"]
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
tags: ["quick-capture","notices","wcag-2.2.1"]
error_code: null
preconditions:
  - "page.clock instalado"
  - "el aviso del gasto de 45.00 BOB visible"
input:
  minutos: "10"
steps:
  - "se adelanta el reloj de la página 10 minutos"
  - "el usuario pulsa \"Deshacer\""
expected_result:
  - "el aviso y su \"Deshacer\" siguen visibles antes de pulsar"
  - "el gasto queda anulado"
created: 2026-11-25
updated: 2026-11-25
---

# TC-TRANSACTIONS-QUICK-009 — Deshacer sigue disponible 10 minutos después del registro

## Intención

Verifica D508: sin el límite de 10 s de docs/28 §4.1, que incumple WCAG 2.2.1 para quien necesita más tiempo.

## Escenario

```gherkin
Dado page.clock instalado
  Y el aviso del gasto de 45.00 BOB visible
Cuando se adelanta el reloj de la página 10 minutos
  Y el usuario pulsa "Deshacer"
Entonces el aviso y su "Deshacer" siguen visibles antes de pulsar
  Y el gasto queda anulado
```

## Notas

- Change `add-quick-capture` (lote L2, docs/78; decisiones en docs/79). Datos ficticios; ningún dato real del owner.
