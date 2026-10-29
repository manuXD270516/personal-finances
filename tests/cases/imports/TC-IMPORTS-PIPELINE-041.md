---
id: TC-IMPORTS-PIPELINE-041
title: "Editar la descripción y la categoría de una fila no crea ninguna transacción"
spec: imports/import-pipeline
related_specs: []
requirement: "Vista previa editable por fila y en lote"
scenario: "Edición de una fila"
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
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Edición de una fila\" del delta de add-import-pipeline"
steps:
  - "el EDITOR cambia la descripción de la fila \"DEB AUT 0412\" a \"Seguro del auto\" y su categoría a \"Seguros\""
expected_result:
  - "la vista previa muestra esa fila con la descripción y la categoría nuevas con origen manual"
  - "no existe ninguna transacción importada"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-041 — Editar la descripción y la categoría de una fila no crea ninguna transacción

## Intención

Antes de aprobar, el OWNER o EDITOR DEBE (MUST) poder cambiar en cada fila la categoría, la contraparte, las etiquetas, la descripción y la nota, y excluirla o volver a incluirla, y DEBE (MUST) poder aplicar el mismo cambio a todas las filas de un filtro de la vista previa; cada edición DEBE (MUST) exigir la versión vigente de la importación (`CONCURRENCY_CONFLICT` si cambió), dejar el campo con origen manual y NO DEBE (MUST NOT) crear ni modificar ninguna transacción.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el EDITOR cambia la descripción de la fila "DEB AUT 0412" a "Seguro del auto" y su categoría a "Seguros"
Entonces la vista previa muestra esa fila con la descripción y la categoría nuevas con origen manual
  Y no existe ninguna transacción importada
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
