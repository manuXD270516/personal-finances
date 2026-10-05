---
id: TC-PLANNING-THRESHOLD-006
title: 'Cruzar varios umbrales a la vez emite un solo hecho con el más alto'
spec: planning/budgets
related_specs: []
requirement: 'Cruce simultáneo de varios umbrales'
scenario: 'Del 46.7 % al 91.7 %'
requirement_status: provisional
fr: ['FR-PLANNING-022']
nfr: []
invariants: []
priority: critical
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags: ['budgets', 'thresholds']
error_code: null
preconditions:
  - '"Restaurantes" máximo 600.00 BOB con umbrales por defecto y gastado 280.00 BOB (46.7 %)'
input:
  expense: '270.00 BOB'
  later: '50.00 BOB'
steps:
  - 'Postear el gasto de 270.00 BOB (gastado 550.00 BOB, 91.7 %)'
  - 'Postear 50.00 BOB más (gastado 600.00 BOB)'
expected_result:
  - 'Un único hecho con threshold "90" y alsoCrossed ["50","75"]'
  - 'Se registran cruces de 50, 75 y 90 %'
  - 'Al llegar a 600.00 BOB solo se emite el hecho del 100 %'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-THRESHOLD-006 — Cruzar varios umbrales a la vez emite un solo hecho con el más alto

## Intención

Evita tres alertas por un solo gasto (design.md decisión 8).

## Escenario

```gherkin
Dado "Restaurantes" con gastado 280.00 BOB de 600.00 BOB
Cuando se postea un gasto de 270.00 BOB
Entonces se emite un solo hecho de umbral 90 % indicando también 50 y 75 %
Cuando el gastado llega a 600.00 BOB
Entonces solo se emite el hecho del 100 %
```

## Notas

- draft: pendiente de la pregunta abierta 3 de add-budgets.
