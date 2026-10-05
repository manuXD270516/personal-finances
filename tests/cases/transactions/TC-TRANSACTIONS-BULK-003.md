---
id: TC-TRANSACTIONS-BULK-003
title: "Una versión obsoleta o un ítem inexistente anulan toda la edición masiva"
spec: transactions/bulk-edit
related_specs: []
requirement: "Ejecución todo o nada de la edición masiva"
scenario: "Un ítem con versión obsoleta"
requirement_status: provisional
fr: [FR-TRANSACTIONS-033, FR-TRANSACTIONS-011]
nfr: [NFR-DATA-014]
invariants: [INV-029]
priority: critical
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ["bulk-edit", "atomic", "concurrency"]
error_code: "PRECONDITION_FAILED"
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
  - "T2 fue editada antes y está en versión 2"
input:
  - "{\"items\":[{\"id\":\"T1\",\"version\":2},{\"id\":\"T2\",\"version\":1},{\"id\":\"T3\",\"version\":4}],\"changes\":{\"categoryId\":\"Hogar\"}}"
  - "{\"items\":[{\"id\":\"T1\",\"version\":2},{\"id\":\"inexistente\",\"version\":1}],\"changes\":{\"categoryId\":\"Hogar\"}}"
steps:
  - "Enviar el primer lote"
  - "Enviar el segundo lote"
expected_result:
  - "412 PRECONDITION_FAILED con errors[] para /items/1 (T2)"
  - "T1, T2 y T3 conservan \"Supermercado\" y su versión"
  - "Segundo lote: 404 RESOURCE_NOT_FOUND para el ítem inexistente; T1 sin cambios"
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-BULK-003 — Una versión obsoleta o un ítem inexistente anulan toda la edición masiva

## Intención

Semántica ALL_OR_NOTHING del lote cleared de Phase 1 generalizada (decisión 1 de add-bulk-edit).

## Escenario

```gherkin
Dado tres gastos y uno de ellos con versión obsoleta en el lote
Cuando el usuario envía la recategorización en lote
Entonces se rechaza con "PRECONDITION_FAILED" para ese gasto
  Y ninguno de los tres cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
