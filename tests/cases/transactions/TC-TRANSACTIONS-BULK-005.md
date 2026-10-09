---
id: TC-TRANSACTIONS-BULK-005
title: "La categoría en lote solo aplica a transacciones de un único split nominal"
spec: transactions/bulk-edit
related_specs: ["transactions/splits"]
requirement: "Aplicabilidad de los cambios masivos"
scenario: "Categoría sobre un gasto con dos splits"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-TRANSACTIONS-026]
nfr: []
invariants: [INV-021]
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
  - packages/contexts/transactions/src/application/bulk-edit.service.test.ts
  - packages/contexts/transactions/src/domain/bulk-edit.test.ts
  - tests/e2e/specs/bulk-edit.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ["bulk-edit", "splits"]
error_code: "BULK_EDIT_NOT_APPLICABLE"
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
  - "T4: gasto de 300.00 BOB con splits de 200.00 y 100.00 BOB"
  - "TR1: transferencia de 100.00 BOB"
input:
  - "{\"items\":[\"T1\",\"T4\"],\"changes\":{\"categoryId\":\"Hogar\"}}"
  - "{\"items\":[\"TR1\"],\"changes\":{\"categoryId\":\"Hogar\"}}"
  - "{\"items\":[\"T1\",\"T4\"],\"changes\":{\"addTagIds\":[\"viaje\"]}}"
steps:
  - "Enviar cada lote"
expected_result:
  - "T4: 422 BULK_EDIT_NOT_APPLICABLE; T1 sin cambios"
  - "TR1: 422 BULK_EDIT_NOT_APPLICABLE"
  - "Tag \"viaje\": los dos splits de T4 y el split de T1 quedan etiquetados; Σ splits de T4 sigue 300.00 BOB"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-005 — La categoría en lote solo aplica a transacciones de un único split nominal

## Intención

Evita repartir en silencio una categoría entre splits o clasificar transferencias.

## Escenario

```gherkin
Dado un gasto de 300.00 BOB con dos splits
Cuando el lote "categoría Hogar" lo incluye
Entonces se rechaza con "BULK_EDIT_NOT_APPLICABLE"
  Y ninguna transacción del lote cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
