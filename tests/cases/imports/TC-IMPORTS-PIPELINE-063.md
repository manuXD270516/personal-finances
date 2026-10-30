---
id: TC-IMPORTS-PIPELINE-063
title: "Un VIEWER que intenta deshacer una importación recibe INSUFFICIENT_ROLE"
spec: imports/import-pipeline
related_specs: []
requirement: "Permisos y auditoría de perfiles, vínculos y deshacer"
scenario: "VIEWER intenta deshacer"
requirement_status: provisional
fr: ["FR-IDENTITY-006", "FR-AUDIT-002", "FR-IMPORTS-005", "FR-IMPORTS-012"]
nfr: []
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/imports-pipeline.api.test.ts
status: automated
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"VIEWER intenta deshacer\" del delta de add-import-pipeline"
steps:
  - "un VIEWER pide deshacer una importación completada"
expected_result:
  - "se rechaza con `INSUFFICIENT_ROLE` y ninguna transacción cambia"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-063 — Un VIEWER que intenta deshacer una importación recibe INSUFFICIENT_ROLE

## Intención

Solo OWNER y EDITOR DEBEN (MUST) poder crear, versionar y archivar perfiles, editar filas, confirmar vínculos con compromisos y deshacer importaciones; un VIEWER DEBE (MUST) poder consultarlos y recibir `INSUFFICIENT_ROLE` al modificarlos.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando un VIEWER pide deshacer una importación completada
Entonces se rechaza con `INSUFFICIENT_ROLE` y ninguna transacción cambia
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
