---
id: TC-IMPORTS-PIPELINE-073
title: "Una descripción propuesta con forma de id valida como texto"
spec: imports/import-pipeline
related_specs: ["platform/api-conventions"]
requirement: "Propuesta de la vista previa con un tipo de valor por campo"
scenario: "Descripción con forma de id"
requirement_status: provisional
fr: ["FR-IMPORTS-009"]
nfr: ["NFR-MAINT-009"]
invariants: []
priority: medium
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["imports","contract","preview"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; una importación en revisión con la fila \"DEB AUT 0412\" y una regla activa que propone categoría, contraparte, etiquetas y descripción"
  - "Validador del contrato `contracts/openapi/finance-api.v1.yaml` sin filtros de errores; datos ficticios"
input: {}
steps:
  - "la descripción propuesta de una fila es el texto \"0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d8e\""
expected_result:
  - "la descripción se publica como texto y la respuesta valida contra el contrato sin errores"
created: 2026-11-25
updated: 2026-11-25
---
# TC-IMPORTS-PIPELINE-073 — Una descripción propuesta con forma de id valida como texto

## Intención

Verifica el scenario "Descripción con forma de id" del requirement "Propuesta de la vista previa con un tipo de valor por campo" de `imports/import-pipeline` (FR-IMPORTS-009, NFR-MAINT-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; una importación en revisión con la fila "DEB AUT 0412" y una regla activa que propone categoría, contraparte, etiquetas y descripción
Cuando la descripción propuesta de una fila es el texto "0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d8e"
Entonces la descripción se publica como texto y la respuesta valida contra el contrato sin errores
```

## Notas

- Change `fix-import-proposed-field-schema` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
