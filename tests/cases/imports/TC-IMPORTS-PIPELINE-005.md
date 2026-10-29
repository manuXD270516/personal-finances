---
id: TC-IMPORTS-PIPELINE-005
title: "Un documento pendiente de subida se rechaza con DOCUMENT_NOT_AVAILABLE sin crear la importación"
spec: imports/import-pipeline
related_specs: ["documents/attachments"]
requirement: "Importación desde un documento subido"
scenario: "Documento no disponible"
requirement_status: provisional
fr: ["FR-IMPORTS-001", "FR-IMPORTS-002", "FR-DOCUMENTS-003"]
nfr: ["NFR-SEC-012"]
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
error_code: DOCUMENT_NOT_AVAILABLE
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Documento no disponible\" del delta de add-import-pipeline"
steps:
  - "un EDITOR crea una importación con un documento que sigue \"pendiente de subida\""
expected_result:
  - "se rechaza con `DOCUMENT_NOT_AVAILABLE` y no se crea ninguna importación"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-005 — Un documento pendiente de subida se rechaza con DOCUMENT_NOT_AVAILABLE sin crear la importación

## Intención

Un OWNER o EDITOR DEBE (MUST) poder iniciar la importación de un documento del workspace subido con el propósito "extracto para importar" indicando una única cuenta destino activa; el documento DEBE (MUST) estar disponible y la importación DEBE (MUST) quedar vinculada a él en la misma unidad de trabajo que la crea, sin leer todavía su contenido ni crear ninguna transacción.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando un EDITOR crea una importación con un documento que sigue "pendiente de subida"
Entonces se rechaza con `DOCUMENT_NOT_AVAILABLE` y no se crea ninguna importación
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
