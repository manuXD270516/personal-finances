---
id: TC-CLASSIFICATION-CUSTOMFIELD-002
title: "La clave del custom field es única entre las activas e inmutable"
spec: classification/custom-fields
related_specs: []
requirement: "Clave única e inmutable del custom field"
scenario: "Clave repetida"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009]
nfr: []
invariants: []
priority: medium
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/classification/src/domain/custom-field.test.ts
  - packages/contexts/classification/src/application/custom-fields.service.test.ts
  - apps/api/test/api/custom-fields.api.test.ts
status: automated
regression_suite: false
phase: 2
tags: ["custom-fields"]
error_code: "CUSTOM_FIELD_KEY_TAKEN"
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Gasto de 45.90 BOB con centro_costo = \"oficina\""
input:
  - "{\"key\":\"centro_costo\"}"
  - "{\"patch\":{\"key\":\"cc\"}}"
  - "{\"patch\":{\"label\":\"Centro de gasto\"}}"
  - "{\"key\":\"Centro Costo\"}"
steps:
  - "Definir otra con la misma clave"
  - "PATCH de la clave"
  - "PATCH de la etiqueta"
  - "Definir con clave inválida"
expected_result:
  - "409 CUSTOM_FIELD_KEY_TAKEN"
  - "PATCH de clave: 400 VALIDATION_FAILED (campo no editable)"
  - "Etiqueta cambiada; el gasto sigue con \"oficina\""
  - "Clave inválida: 400 VALIDATION_FAILED"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-002 — La clave del custom field es única entre las activas e inmutable

## Intención

La clave es el identificador estable para filtros, export y reglas futuras.

## Escenario

```gherkin
Dado la definición activa "centro_costo"
Cuando el usuario define otra con la clave "centro_costo"
Entonces se rechaza con "CUSTOM_FIELD_KEY_TAKEN"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
