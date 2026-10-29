---
id: TC-IMPORTS-PIPELINE-065
title: "Crear y editar un perfil deja un registro de auditoría por versión"
spec: imports/import-pipeline
related_specs: ["audit/audit-trail"]
requirement: "Permisos y auditoría de perfiles, vínculos y deshacer"
scenario: "Auditoría de las versiones de un perfil"
requirement_status: provisional
fr: ["FR-IDENTITY-006", "FR-AUDIT-002", "FR-IMPORTS-005", "FR-IMPORTS-012"]
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
input: "Datos del scenario \"Auditoría de las versiones de un perfil\" del delta de add-import-pipeline"
steps:
  - "el EDITOR crea un perfil y luego lo edita"
expected_result:
  - "existen dos registros de auditoría, de la versión 1 y de la versión 2, con el EDITOR como actor"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-065 — Crear y editar un perfil deja un registro de auditoría por versión

## Intención

Solo OWNER y EDITOR DEBEN (MUST) poder crear, versionar y archivar perfiles, editar filas, confirmar vínculos con compromisos y deshacer importaciones; un VIEWER DEBE (MUST) poder consultarlos y recibir `INSUFFICIENT_ROLE` al modificarlos.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el EDITOR crea un perfil y luego lo edita
Entonces existen dos registros de auditoría, de la versión 1 y de la versión 2, con el EDITOR como actor
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
