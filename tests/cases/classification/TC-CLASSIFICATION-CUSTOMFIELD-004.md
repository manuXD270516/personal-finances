---
id: TC-CLASSIFICATION-CUSTOMFIELD-004
title: "Cada split guarda su propio valor y los campos de cuenta no aplican a transacciones"
spec: classification/custom-fields
related_specs: ["transactions/splits"]
requirement: "Custom fields de transacción por split"
scenario: "Valores distintos por split"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009, FR-TRANSACTIONS-026]
nfr: []
invariants: [INV-021]
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/transactions/src/application/custom-fields.service.test.ts
  - packages/contexts/classification/src/application/custom-fields.service.test.ts
  - packages/contexts/accounts/src/application/custom-fields.service.test.ts
  - apps/api/test/api/custom-fields.api.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["custom-fields", "splits"]
error_code: "CUSTOM_FIELD_TARGET_MISMATCH"
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Custom field de cuenta \"sucursal\" (TEXT)"
input:
  - "{\"amount\":\"300.00\",\"splits\":[{\"amount\":\"200.00\",\"centro_costo\":\"casa\"},{\"amount\":\"100.00\",\"centro_costo\":\"oficina\"}]}"
  - "{\"amount\":\"45.90\",\"splits\":[{\"amount\":\"45.90\",\"sucursal\":\"Centro\"}]}"
steps:
  - "Registrar el gasto de 300.00 BOB"
  - "Registrar el gasto con \"sucursal\""
expected_result:
  - "Splits con \"casa\" y \"oficina\"; Σ splits = 300.00 BOB"
  - "\"sucursal\" en transacción: 422 CUSTOM_FIELD_TARGET_MISMATCH"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-004 — Cada split guarda su propio valor y los campos de cuenta no aplican a transacciones

## Intención

FR-TRANSACTIONS-026: los custom fields viven por split, con objetivo validado.

## Escenario

```gherkin
Dado el custom field "centro_costo"
Cuando el usuario registra un gasto de 300.00 BOB con splits "casa" 200.00 y "oficina" 100.00
Entonces cada split conserva su valor
  Y la suma de splits sigue siendo 300.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
