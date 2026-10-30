---
id: TC-IMPORTS-PIPELINE-039
title: "Reevaluar las reglas conserva los campos que el usuario editó en la vista previa"
spec: imports/import-pipeline
related_specs: ["rules/rule-engine"]
requirement: "Orden de la clasificación y de los duplicados en la vista previa"
scenario: "Reevaluar reglas conserva lo editado"
requirement_status: provisional
fr: ["FR-IMPORTS-002", "FR-IMPORTS-008", "FR-RULES-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/imports/pipeline.test.tsx
  - packages/contexts/imports/src/domain/row-edits.test.ts
  - packages/contexts/imports/src/testing/import-pipeline.review.test.ts
  - packages/contexts/imports/test/integration/pg-pipeline.int.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Reevaluar reglas conserva lo editado\" del delta de add-import-pipeline"
steps:
  - "el usuario cambió la categoría de una fila a \"Hogar\", luego se edita una regla que también la clasificaría y el usuario pide reevaluar las reglas"
expected_result:
  - "esa fila conserva \"Hogar\" con origen manual"
  - "las filas que el usuario no editó muestran la propuesta de la regla editada"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-039 — Reevaluar las reglas conserva los campos que el usuario editó en la vista previa

## Intención

El sistema DEBE (MUST) evaluar las reglas sobre cada fila normalizada y válida antes de calcular sus duplicados probables y sus coincidencias con compromisos, de modo que la contraparte y el tipo propuestos participen de esos cálculos; reevaluar las reglas desde la vista previa DEBE (MUST) conservar los campos que el usuario editó; y una falla de la evaluación de reglas DEBE (MUST) dejar las filas sin propuesta con la advertencia `IMPORT_RULES_UNAVAILABLE`, sin impedir la revisión ni la aprobación.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el usuario cambió la categoría de una fila a "Hogar", luego se edita una regla que también la clasificaría y el usuario pide reevaluar las reglas
Entonces esa fila conserva "Hogar" con origen manual
  Y las filas que el usuario no editó muestran la propuesta de la regla editada
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
