---
id: TC-DOCUMENTS-ATTACH-024
title: "Restaurar el archivo de contenidos deja los documentos disponibles y es idempotente"
spec: identity/workspace-portability
related_specs: []
requirement: "Archivo de contenidos de documentos del export"
scenario: null
requirement_status: provisional
fr:
  - "FR-IDENTITY-010"
nfr:
  - "NFR-REL-014"
  - "NFR-SEC-006"
invariants: []
priority: medium
type: integration
level: container-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "portability"
  - "restore"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Export de W1 con includeDocumentContents true e importado (TC-DOCUMENTS-ATTACH-023)"
input:
  usuario: "owner"
  requests:
    - "GET W/exports/{id}/document-contents/download"
    - "POST W/documents/content-restores (dos veces)"
steps:
  - "Descargar el archivo de contenidos"
  - "Leer el objeto en el bucket de exports"
  - "Restaurar dos veces sobre el workspace nuevo"
  - "Descargar los 3 documentos"
expected_result:
  - "El objeto almacenado está cifrado; el ZIP principal no cambió de tamaño"
  - "3 documentos AVAILABLE con claves nuevas y sumas originales"
  - "La segunda restauración no crea objetos ni registros nuevos"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-024 — Restaurar el archivo de contenidos deja los documentos disponibles y es idempotente

## Intención

Contenidos en un archivo aparte sin tocar D100 (pregunta 3).

## Escenario

```gherkin
Dado el workspace importado con 3 documentos con contenido pendiente
Cuando el OWNER restaura el archivo de contenidos
Entonces los 3 documentos quedan disponibles con sus sumas originales
Y restaurarlo de nuevo no duplica nada
```

## Notas

- Change: `add-document-attachments`. Requirement: "Archivo de contenidos de documentos del export" (`identity/workspace-portability`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
