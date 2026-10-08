---
id: TC-CLASSIFICATION-CUSTOMFIELD-006
title: "Un custom field obligatorio se exige en registros nuevos y no es retroactivo"
spec: classification/custom-fields
related_specs: ["transactions/transaction-recording"]
requirement: "Custom field obligatorio en registros nuevos"
scenario: "Gasto nuevo sin el campo obligatorio"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["custom-fields"]
error_code: "CUSTOM_FIELD_REQUIRED"
preconditions:
  - "Gasto G0 de 150.00 BOB registrado sin centro_costo"
  - "\"centro_costo\" pasa a obligatorio"
input:
  - "{\"create\":{\"amount\":\"45.90\"}}"
  - "{\"patch\":{\"transaction\":\"G0\",\"description\":\"Compra mensual\"}}"
steps:
  - "Registrar un gasto nuevo sin centro_costo"
  - "Editar la descripción de G0"
expected_result:
  - "422 CUSTOM_FIELD_REQUIRED; no se registra"
  - "G0 editado; sigue sin centro_costo"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-006 — Un custom field obligatorio se exige en registros nuevos y no es retroactivo

## Intención

Hacer obligatorio un campo no invalida la historia (decisión 6 de add-custom-fields).

## Escenario

```gherkin
Dado "centro_costo" obligatorio
Cuando el usuario registra un gasto de 45.90 BOB sin indicarlo
Entonces se rechaza con "CUSTOM_FIELD_REQUIRED"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
