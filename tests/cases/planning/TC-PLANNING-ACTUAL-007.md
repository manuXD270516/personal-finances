---
id: TC-PLANNING-ACTUAL-007
title: 'El gastado es igual a la suma de splits posteados para cualquier historia de eventos'
spec: planning/budgets
related_specs: []
requirement: 'Gasto real derivado de transacciones posteadas'
scenario: null
requirement_status: confirmed
fr: ['FR-PLANNING-023', 'FR-PLANNING-024']
nfr: []
invariants: ['INV-034', 'INV-028']
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['budgets', 'actual', 'pbt']
error_code: null
preconditions:
  - 'Generador fast-check de secuencias de registrar, postear, editar, recategorizar, reembolsar y anular en BOB'
input:
  runs: '1000 en CI, 100000 nightly'
steps:
  - 'Aplicar la secuencia generada'
  - 'Calcular el gastado por categoría del periodo'
expected_result:
  - 'Para toda secuencia: gastado(categoría) == Σ splits vigentes posteados de la categoría y sus subcategorías en el rango del periodo'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ACTUAL-007 — El gastado es igual a la suma de splits posteados para cualquier historia de eventos

## Intención

INV-034: los actuales son derivados y reconstruibles; nunca se editan a mano.

## Escenario

```gherkin
Dada cualquier secuencia válida de comandos de transacciones
Cuando calculo el gastado del plan
Entonces coincide con la suma de splits posteados por categoría y periodo
```

## Notas

