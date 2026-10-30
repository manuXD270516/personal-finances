---
id: TC-IMPORTS-PIPELINE-042
title: "Una edición en lote asigna la categoría a las 40 filas filtradas y no toca las demás"
spec: imports/import-pipeline
related_specs: []
requirement: "Vista previa editable por fila y en lote"
scenario: "Edición en lote de las filas filtradas"
requirement_status: provisional
fr: ["FR-IMPORTS-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - apps/web/src/ui/imports/pipeline-logic.test.ts
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
input: "Datos del scenario \"Edición en lote de las filas filtradas\" del delta de add-import-pipeline"
steps:
  - "el EDITOR filtra las 40 filas sin categoría y les asigna \"Transporte\""
expected_result:
  - "las 40 filas muestran \"Transporte\" con origen manual y las demás filas no cambian"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-042 — Una edición en lote asigna la categoría a las 40 filas filtradas y no toca las demás

## Intención

Antes de aprobar, el OWNER o EDITOR DEBE (MUST) poder cambiar en cada fila la categoría, la contraparte, las etiquetas, la descripción y la nota, y excluirla o volver a incluirla, y DEBE (MUST) poder aplicar el mismo cambio a todas las filas de un filtro de la vista previa; cada edición DEBE (MUST) exigir la versión vigente de la importación (412 `PRECONDITION_FAILED` si cambió), dejar el campo con origen manual y NO DEBE (MUST NOT) crear ni modificar ninguna transacción.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el EDITOR filtra las 40 filas sin categoría y les asigna "Transporte"
Entonces las 40 filas muestran "Transporte" con origen manual y las demás filas no cambian
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
