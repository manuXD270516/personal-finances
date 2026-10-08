---
id: TC-CLASSIFICATION-CUSTOMFIELD-009
title: "Tipo, objetivo y opciones en uso de un custom field con valores no cambian"
spec: classification/custom-fields
related_specs: []
requirement: "Cambios protegidos de una definición con valores"
scenario: "Cambiar el tipo de un campo con valores"
requirement_status: confirmed
fr: [FR-CLASSIFICATION-009]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 2
tags: ["custom-fields"]
error_code: "CUSTOM_FIELD_TYPE_LOCKED"
preconditions:
  - "Custom field de transacción \"centro_costo\" (SELECT, opciones \"casa\" y \"oficina\", no obligatorio)"
  - "Un gasto con centro_costo = \"oficina\""
input:
  - "{\"patch\":{\"dataType\":\"TEXT\"}}"
  - "{\"patch\":{\"target\":\"ACCOUNT\"}}"
  - "{\"patch\":{\"removeOption\":\"oficina\"}}"
  - "{\"patch\":{\"addOption\":\"taller\"}}"
steps:
  - "Aplicar cada cambio"
expected_result:
  - "Tipo y objetivo: 409 CUSTOM_FIELD_TYPE_LOCKED"
  - "Quitar \"oficina\": 409 CUSTOM_FIELD_OPTION_IN_USE"
  - "Agregar \"taller\": aceptado"
created: 2026-10-05
updated: 2026-10-08
---

# TC-CLASSIFICATION-CUSTOMFIELD-009 — Tipo, objetivo y opciones en uso de un custom field con valores no cambian

## Intención

Protege la interpretación de los valores ya guardados.

## Escenario

```gherkin
Dado "centro_costo" con valores
Cuando el usuario intenta cambiar su tipo a texto
Entonces se rechaza con "CUSTOM_FIELD_TYPE_LOCKED"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock`.
