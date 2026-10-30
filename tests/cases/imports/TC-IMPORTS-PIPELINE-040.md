---
id: TC-IMPORTS-PIPELINE-040
title: "Una falla de la evaluación de reglas deja las filas sin propuesta y no impide aprobar"
spec: imports/import-pipeline
related_specs: ["rules/rule-engine"]
requirement: "Orden de la clasificación y de los duplicados en la vista previa"
scenario: "Evaluación de reglas no disponible"
requirement_status: provisional
fr: ["FR-IMPORTS-002", "FR-IMPORTS-008", "FR-RULES-009"]
nfr: []
invariants: []
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/import-pipeline.review.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_RULES_UNAVAILABLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Evaluación de reglas no disponible\" del delta de add-import-pipeline"
steps:
  - "la evaluación de reglas falla al procesar una importación"
expected_result:
  - "las filas quedan sin propuesta de reglas con la advertencia `IMPORT_RULES_UNAVAILABLE`"
  - "la importación llega a \"en revisión\" y se puede aprobar"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-040 — Una falla de la evaluación de reglas deja las filas sin propuesta y no impide aprobar

## Intención

El sistema DEBE (MUST) evaluar las reglas sobre cada fila normalizada y válida antes de calcular sus duplicados probables y sus coincidencias con compromisos, de modo que la contraparte y el tipo propuestos participen de esos cálculos; reevaluar las reglas desde la vista previa DEBE (MUST) conservar los campos que el usuario editó; y una falla de la evaluación de reglas DEBE (MUST) dejar las filas sin propuesta con la advertencia `IMPORT_RULES_UNAVAILABLE`, sin impedir la revisión ni la aprobación.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la evaluación de reglas falla al procesar una importación
Entonces las filas quedan sin propuesta de reglas con la advertencia `IMPORT_RULES_UNAVAILABLE`
  Y la importación llega a "en revisión" y se puede aprobar
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
