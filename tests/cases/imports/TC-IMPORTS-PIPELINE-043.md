---
id: TC-IMPORTS-PIPELINE-043
title: "Editar una fila con una versión vencida se rechaza con CONCURRENCY_CONFLICT"
spec: imports/import-pipeline
related_specs: []
requirement: "Vista previa editable por fila y en lote"
scenario: "Edición con una versión vencida"
requirement_status: provisional
fr: ["FR-IMPORTS-009"]
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: CONCURRENCY_CONFLICT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Edición con una versión vencida\" del delta de add-import-pipeline"
steps:
  - "el EDITOR edita una fila con una versión de la importación que otra edición ya cambió"
expected_result:
  - "se rechaza con `CONCURRENCY_CONFLICT` y la fila no cambia"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-043 — Editar una fila con una versión vencida se rechaza con CONCURRENCY_CONFLICT

## Intención

Antes de aprobar, el OWNER o EDITOR DEBE (MUST) poder cambiar en cada fila la categoría, la contraparte, las etiquetas, la descripción y la nota, y excluirla o volver a incluirla, y DEBE (MUST) poder aplicar el mismo cambio a todas las filas de un filtro de la vista previa; cada edición DEBE (MUST) exigir la versión vigente de la importación (`CONCURRENCY_CONFLICT` si cambió), dejar el campo con origen manual y NO DEBE (MUST NOT) crear ni modificar ninguna transacción.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el EDITOR edita una fila con una versión de la importación que otra edición ya cambió
Entonces se rechaza con `CONCURRENCY_CONFLICT` y la fila no cambia
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
