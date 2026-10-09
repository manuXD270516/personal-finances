---
id: TC-TRANSACTIONS-BULK-010
title: "La edición masiva fija valores de custom fields validados"
spec: transactions/bulk-edit
related_specs: ["classification/custom-fields"]
requirement: "Custom fields en la edición masiva"
scenario: "Fijar el centro de costo en lote"
requirement_status: confirmed
fr: [FR-TRANSACTIONS-033, FR-CLASSIFICATION-009]
nfr: []
invariants: [INV-033]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/bulk-edit.api.test.ts
  - packages/contexts/transactions/src/application/bulk-edit.service.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["bulk-edit", "custom-fields"]
error_code: "CUSTOM_FIELD_VALUE_INVALID"
preconditions:
  - "Workspace \"W1\"; cuenta \"Bank A\" (BOB) con saldo 2000.00 BOB"
  - "Gastos posted de un split en marzo de 2026, categoría \"Supermercado\": T1 45.90 BOB (v2), T2 150.00 BOB (v1), T3 200.00 BOB (v4)"
  - "Categoría de gasto activa \"Hogar\"; tag activo \"familia\""
  - "Custom field de transacción \"centro_costo\" SELECT con opciones \"casa\" y \"oficina\""
input:
  - "{\"items\":[\"T1\",\"T2\"],\"changes\":{\"customFields\":[{\"field\":\"centro_costo\",\"value\":\"oficina\"}]}}"
  - "{\"items\":[\"T1\",\"T2\"],\"changes\":{\"customFields\":[{\"field\":\"centro_costo\",\"value\":\"taller\"}]}}"
steps:
  - "Enviar el primer lote"
  - "Enviar el segundo lote"
expected_result:
  - "T1 y T2 con centro_costo = \"oficina\"; \"Bank A\" sigue en 2000.00 BOB"
  - "\"taller\": 422 CUSTOM_FIELD_VALUE_INVALID; nada cambia"
created: 2026-10-05
updated: 2026-10-08
---

# TC-TRANSACTIONS-BULK-010 — La edición masiva fija valores de custom fields validados

## Intención

Depende de add-custom-fields; valida valores con el mismo puerto que la edición individual.

## Escenario

```gherkin
Dado el custom field "centro_costo" con opciones "casa" y "oficina"
Cuando el usuario fija "oficina" en lote a dos gastos
Entonces ambos quedan con "oficina"
  Y el saldo de sus cuentas no cambia
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
