---
id: TC-TRANSACTIONS-BULK-009
title: "La edición masiva es idempotente y limita el lote a 500 transacciones"
spec: transactions/bulk-edit
related_specs: ["platform/api-conventions"]
requirement: "Límite e idempotencia de la edición masiva"
scenario: "Reenvío de la misma edición masiva"
requirement_status: provisional
fr: [FR-TRANSACTIONS-033, FR-TRANSACTIONS-010]
nfr: []
invariants: [INV-027]
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["bulk-edit", "idempotency"]
error_code: "IDEMPOTENCY_KEY_REUSED"
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
input:
  - "{\"key\":\"K1\",\"changes\":{\"categoryId\":\"Hogar\"}}"
  - "{\"key\":\"K1\",\"replay\":true}"
  - "{\"key\":\"K1\",\"changes\":{\"categoryId\":\"Ocio\"}}"
  - "{\"items\":501}"
steps:
  - "Enviar con K1"
  - "Reenviar idéntico con K1"
  - "Reenviar con K1 y otro contenido"
  - "Enviar 501 ítems"
expected_result:
  - "Reenvío: misma respuesta y bulkOperationId, Idempotent-Replayed, sin versiones nuevas ni auditoría"
  - "Contenido distinto: 422 IDEMPOTENCY_KEY_REUSED"
  - "501 ítems: 400 VALIDATION_FAILED"
created: 2026-10-05
updated: 2026-10-05
---

# TC-TRANSACTIONS-BULK-009 — La edición masiva es idempotente y limita el lote a 500 transacciones

## Intención

INV-027 en una operación con muchos efectos.

## Escenario

```gherkin
Dado una recategorización en lote ya aplicada con una clave
Cuando el usuario la reenvía con la misma clave
Entonces obtiene el mismo resultado sin aplicar cambios de nuevo
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
