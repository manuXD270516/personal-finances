---
id: TC-TRANSACTIONS-BULK-001
title: "La edición masiva recategoriza y etiqueta varias transacciones a la vez"
spec: transactions/bulk-edit
related_specs: ["classification/categories", "classification/tags"]
requirement: "Edición masiva de clasificación"
scenario: "Recategorizar y etiquetar tres gastos"
requirement_status: provisional
fr: [FR-TRANSACTIONS-033, FR-CLASSIFICATION-008]
nfr: []
invariants: [INV-033, INV-019]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["bulk-edit", "classification"]
error_code: null
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
  - "Categoría archivada \"Mascotas\"; categoría de ingreso \"Sueldo\""
input:
  - "{\"items\":[{\"id\":\"T1\",\"version\":2},{\"id\":\"T2\",\"version\":1},{\"id\":\"T3\",\"version\":4}],\"changes\":{\"categoryId\":\"Hogar\",\"addTagIds\":[\"familia\"]}}"
  - "{\"changes\":{\"categoryId\":\"Mascotas\"}}"
  - "{\"changes\":{\"categoryId\":\"Sueldo\"}}"
steps:
  - "POST W/transactions/bulk-edit con Idempotency-Key"
  - "Repetir en estado limpio con \"Mascotas\" y con \"Sueldo\""
expected_result:
  - "T1, T2 y T3 con categoría \"Hogar\" y tag \"familia\"; versiones 3, 2 y 5"
  - "Marzo: \"Supermercado\" −395.90 BOB y \"Hogar\" +395.90 BOB"
  - "\"Mascotas\": 409 CATEGORY_ARCHIVED; \"Sueldo\": 422 CATEGORY_KIND_MISMATCH; nada cambia"
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-BULK-001 — La edición masiva recategoriza y etiqueta varias transacciones a la vez

## Intención

FR-TRANSACTIONS-033 con las mismas reglas de clasificación que la edición individual.

## Escenario

```gherkin
Dado tres gastos de un split categorizados como "Supermercado"
Cuando el usuario aplica en lote la categoría "Hogar" y el tag "familia"
Entonces los tres quedan con "Hogar" y "familia"
  Y "Hogar" aumenta 395.90 BOB en marzo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
