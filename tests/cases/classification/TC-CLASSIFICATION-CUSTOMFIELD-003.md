---
id: TC-CLASSIFICATION-CUSTOMFIELD-003
title: "Los valores se validan por tipo y los decimales se conservan exactos"
spec: classification/custom-fields
related_specs: ["transactions/transaction-recording"]
requirement: "Validación de valores según el tipo"
scenario: "Decimal exacto"
requirement_status: provisional
fr: [FR-CLASSIFICATION-009]
nfr: [NFR-DATA-001, NFR-DATA-010]
invariants: [INV-001]
priority: high
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["custom-fields", "decimal"]
error_code: "CUSTOM_FIELD_VALUE_INVALID"
preconditions:
  - "Custom fields de transacción: \"litros\" DECIMAL, \"cuota\" NUMBER, \"garantia_hasta\" DATE, \"factura\" TEXT, \"deducible\" BOOLEAN"
input:
  - "{\"litros\":\"35.125\"}"
  - "{\"cuota\":\"3.5\"}"
  - "{\"garantia_hasta\":\"2026-02-30\"}"
  - "{\"factura\":\"\"}"
  - "{\"deducible\":\"si\"}"
steps:
  - "Registrar un gasto de 120.00 BOB con cada valor"
  - "PBT: decimales aleatorios hasta 18 decimales ida y vuelta"
expected_result:
  - "\"litros\" = \"35.125\" exacto al consultar"
  - "\"3.5\" en NUMBER, \"2026-02-30\", texto vacío y \"si\" en BOOLEAN: 422 CUSTOM_FIELD_VALUE_INVALID sin registrar el gasto"
  - "PBT: string → Decimal → numeric → string sin pérdida"
created: 2026-10-05
updated: 2026-10-05
---

# TC-CLASSIFICATION-CUSTOMFIELD-003 — Los valores se validan por tipo y los decimales se conservan exactos

## Intención

INV-001 aplicado a decimales de usuario: nunca punto flotante.

## Escenario

```gherkin
Dado el custom field decimal "litros"
Cuando el usuario registra un gasto de 120.00 BOB con "litros" = "35.125"
Entonces al consultarlo el valor es exactamente "35.125"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
