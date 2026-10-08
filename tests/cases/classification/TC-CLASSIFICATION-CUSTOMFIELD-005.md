---
id: TC-CLASSIFICATION-CUSTOMFIELD-005
title: "Una cuenta guarda sus custom fields sin cambiar su saldo"
spec: classification/custom-fields
related_specs: ["accounts/account-management"]
requirement: "Custom fields de cuenta"
scenario: "Sucursal de una cuenta bancaria"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009, FR-ACCOUNTS-001]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/accounts/src/application/custom-fields.service.test.ts
  - apps/api/test/api/custom-fields.api.test.ts
  - tests/e2e/specs/custom-fields.spec.ts
status: automated
regression_suite: false
phase: 2
tags: ["custom-fields", "accounts"]
error_code: null
preconditions:
  - "Custom field de cuenta \"sucursal\" (TEXT)"
  - "\"Bank A\" con saldo 1000.00 BOB"
input:
  account: "Bank A"
  customFields: [{"field":"sucursal","value":"Sucursal Centro"}]
steps:
  - "PATCH W/accounts/{id} con el valor"
  - "GET de la cuenta y de su saldo"
expected_result:
  - "\"sucursal\" = \"Sucursal Centro\""
  - "Saldo 1000.00 BOB y sin asientos nuevos"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-005 — Una cuenta guarda sus custom fields sin cambiar su saldo

## Intención

Custom fields de cuenta como metadatos sin efecto contable.

## Escenario

```gherkin
Dado "Bank A" con saldo 1000.00 BOB
Cuando el usuario asigna "sucursal" = "Sucursal Centro"
Entonces la cuenta la devuelve y su saldo sigue en 1000.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
