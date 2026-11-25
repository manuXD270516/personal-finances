---
id: TC-IMPORTS-PIPELINE-072
title: "La propuesta de la vista previa publica cada campo con su tipo y valida contra el contrato"
spec: imports/import-pipeline
related_specs: ["platform/api-conventions"]
requirement: "Propuesta de la vista previa con un tipo de valor por campo"
scenario: "Propuesta con los cuatro campos"
requirement_status: confirmed
fr: ["FR-IMPORTS-009"]
nfr: ["NFR-MAINT-009"]
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
  - apps/api/test/api/imports-connections.api.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["imports","contract","preview"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; una importación en revisión con la fila \"DEB AUT 0412\" y una regla activa que propone categoría, contraparte, etiquetas y descripción"
  - "Validador del contrato `contracts/openapi/finance-api.v1.yaml` sin filtros de errores; datos ficticios"
input: {}
steps:
  - "una regla propone para la fila \"DEB AUT 0412\" la categoría \"Seguros\", la contraparte \"Aseguradora Andina\", las etiquetas \"auto\" y \"anual\" y la descripción \"Seguro del auto\", y un VIEWER pide la vista previa"
expected_result:
  - "la fila publica la categoría y la contraparte como un id cada una, las etiquetas como una lista de dos ids y la descripción como texto, todas con origen regla, y la respuesta valida contra el contrato sin errores"
created: 2026-11-25
updated: 2026-11-25
---
# TC-IMPORTS-PIPELINE-072 — La propuesta de la vista previa publica cada campo con su tipo y valida contra el contrato

## Intención

Verifica el scenario "Propuesta con los cuatro campos" del requirement "Propuesta de la vista previa con un tipo de valor por campo" de `imports/import-pipeline` (FR-IMPORTS-009, NFR-MAINT-009).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; una importación en revisión con la fila "DEB AUT 0412" y una regla activa que propone categoría, contraparte, etiquetas y descripción
Cuando una regla propone para la fila "DEB AUT 0412" la categoría "Seguros", la contraparte "Aseguradora Andina", las etiquetas "auto" y "anual" y la descripción "Seguro del auto", y un VIEWER pide la vista previa
Entonces la fila publica la categoría y la contraparte como un id cada una, las etiquetas como una lista de dos ids y la descripción como texto, todas con origen regla, y la respuesta valida contra el contrato sin errores
```

## Notas

- Change `fix-import-proposed-field-schema` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
