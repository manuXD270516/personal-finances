---
id: TC-AUDIT-LIFECYCLE-004
title: "Recategorizar un gasto aparece como anotación sin nueva transición ni asiento"
spec: audit/lifecycle-timeline
related_specs: ["transactions/splits"]
requirement: "Cambios descriptivos como anotaciones del recorrido"
scenario: "Recategorizar un gasto posteado"
requirement_status: confirmed
fr: ["FR-AUDIT-010","FR-TRANSACTIONS-008"]
nfr: []
invariants: ["INV-033"]
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["lifecycle","annotation"]
error_code: null
preconditions:
  - "Gasto posteado de 150.00 BOB en la categoría \"Food\""
input: {"categoryId":"Restaurants"}
steps:
  - "Cambiar la categoría del gasto"
  - "Consultar el recorrido y contar asientos"
expected_result:
  - "El recorrido agrega una anotación con changedFields [categoryId]"
  - "El número de transiciones y de asientos no cambia"
created: 2026-10-03
updated: 2026-10-03
---

# TC-AUDIT-LIFECYCLE-004 — Recategorizar un gasto aparece como anotación sin nueva transición ni asiento

## Intención

Separar pasos del flujo de cambios descriptivos mantiene legible el recorrido (D37) y respeta INV-033.

## Escenario

```gherkin
Dado un gasto posteado de 150.00 BOB
Cuando cambio su categoría
Entonces el recorrido muestra una anotación
  Y no hay transiciones ni asientos nuevos
```

## Notas

