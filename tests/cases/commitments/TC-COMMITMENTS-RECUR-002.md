---
id: TC-COMMITMENTS-RECUR-002
title: 'Una definición con moneda distinta a la de la cuenta o categoría archivada se rechaza sin crear nada'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Definición recurrente con tipo, cuentas y plantilla'
scenario: 'Moneda distinta a la de la cuenta'
requirement_status: provisional
fr: ['FR-COMMITMENTS-001']
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'validation']
error_code: CURRENCY_MISMATCH
preconditions:
  - 'Cuenta "Banco BOB" en BOB'
  - 'Categoría "Cable TV" archivada'
input:
  a: 'gasto 25.00 USD en Banco BOB'
  b: 'gasto 120.00 BOB con categoría Cable TV'
steps:
  - 'POST W/recurring con el caso a'
  - 'POST W/recurring con el caso b'
expected_result:
  - 'a: 422 CURRENCY_MISMATCH'
  - 'b: 409 CATEGORY_ARCHIVED'
  - 'No se crea ninguna definición, ocurrencia, auditoría ni evento'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-002 — Una definición con moneda distinta a la de la cuenta o categoría archivada se rechaza sin crear nada

## Intención

Toda definición debe poder materializarse; datos inválidos se rechazan antes de generar ocurrencias.

## Escenario

```gherkin
Dado la cuenta "Banco BOB" en BOB
Cuando el EDITOR crea un gasto recurrente de 25.00 USD en "Banco BOB"
Entonces se rechaza con CURRENCY_MISMATCH
  Y no se crea la definición
```

## Notas

- Cubre también el scenario "Categoría archivada" (CATEGORY_ARCHIVED).
