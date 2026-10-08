---
id: TC-PLANNING-THRESHOLD-004
title: 'Bajar y volver a subir del umbral no re-emite el hecho'
spec: planning/budgets
related_specs: []
requirement: 'Cruce de umbral emitido una sola vez por umbral y periodo'
scenario: 'Sin re-emisión tras bajar y volver a subir'
requirement_status: confirmed
fr: ['FR-PLANNING-022']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: true
phase: 2
tags: ['budgets', 'thresholds', 'exactly-once']
error_code: null
preconditions:
  - 'Estado final de TC-PLANNING-THRESHOLD-003 (cruce del 50 % registrado)'
input:
  refund: '40.00 BOB'
  expense: '60.00 BOB'
steps:
  - 'Postear el reembolso (gastado 270.00 BOB)'
  - 'Postear el gasto (gastado 330.00 BOB)'
expected_result:
  - 'No se emite ningún hecho nuevo del 50 %'
  - 'Sigue habiendo un solo cruce del 50 % para "Restaurantes" en "2026-11"'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-THRESHOLD-004 — Bajar y volver a subir del umbral no re-emite el hecho

## Intención

FR-PLANNING-022: una sola vez por umbral y periodo, aunque el gasto oscile.

## Escenario

```gherkin
Dado el cruce del 50 % ya registrado
Cuando un reembolso baja el gastado a 270.00 BOB y un gasto lo sube a 330.00 BOB
Entonces no se emite un nuevo hecho del 50 %
```

## Notas

