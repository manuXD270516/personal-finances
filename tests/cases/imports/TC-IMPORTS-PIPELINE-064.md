---
id: TC-IMPORTS-PIPELINE-064
title: "Cada vínculo de una fila con un movimiento existente queda auditado con línea, puntaje y actor"
spec: imports/import-pipeline
related_specs: ["audit/audit-trail"]
requirement: "Permisos y auditoría de perfiles, vínculos y deshacer"
scenario: "Auditoría de una vinculación con un movimiento existente"
requirement_status: provisional
fr: ["FR-IDENTITY-006", "FR-AUDIT-002", "FR-IMPORTS-005", "FR-IMPORTS-012"]
nfr: []
invariants: ["INV-029"]
priority: high
type: api
level: api
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/testing/import-pipeline.review.test.ts
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
input: "Datos del scenario \"Auditoría de una vinculación con un movimiento existente\" del delta de add-import-pipeline"
steps:
  - "la EDITOR \"Ana\" aprueba una importación en la que una fila quedó vinculada al gasto manual de 245.30 BOB con puntaje 0.9000"
expected_result:
  - "existe un registro de auditoría de ese vínculo con la línea de la fila, el gasto, el puntaje y \"Ana\" como actor"
created: 2026-10-29
updated: 2026-10-30
---

# TC-IMPORTS-PIPELINE-064 — Cada vínculo de una fila con un movimiento existente queda auditado con línea, puntaje y actor

## Intención

Solo OWNER y EDITOR DEBEN (MUST) poder crear, versionar y archivar perfiles, editar filas, confirmar vínculos con compromisos y deshacer importaciones; un VIEWER DEBE (MUST) poder consultarlos y recibir `INSUFFICIENT_ROLE` al modificarlos.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la EDITOR "Ana" aprueba una importación en la que una fila quedó vinculada al gasto manual de 245.30 BOB con puntaje 0.9000
Entonces existe un registro de auditoría de ese vínculo con la línea de la fila, el gasto, el puntaje y "Ana" como actor
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
