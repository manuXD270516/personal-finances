---
id: TC-DOCUMENTS-ATTACH-025
title: "Un contenido alterado en el archivo deja su documento pendiente y se informa"
spec: identity/workspace-portability
related_specs: []
requirement: "Archivo de contenidos de documentos del export"
scenario: "Contenido alterado en el archivo"
requirement_status: confirmed
fr:
  - "FR-IDENTITY-010"
nfr:
  - "NFR-REL-014"
invariants: []
priority: medium
type: integration
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/documents-portability.api.test.ts", "packages/contexts/documents/src/application/contents-archive.test.ts", "packages/contexts/documents/src/application/contents.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "portability"
  - "restore"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Archivo de contenidos descargado con uno de los 3 contenidos modificado"
input:
  usuario: "owner"
  request: "POST W/documents/content-restores"
steps:
  - "Restaurar"
  - "Consultar el reporte de la operación y los documentos"
expected_result:
  - "2 documentos AVAILABLE y 1 CONTENT_PENDING"
  - "El reporte lista el id del tercero con CHECKSUM_MISMATCH"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-025 — Un contenido alterado en el archivo deja su documento pendiente y se informa

## Intención

La restauración verifica cada contenido como una subida nueva.

## Escenario

```gherkin
Dado un archivo de contenidos con uno de los 3 contenidos modificado
Cuando el OWNER lo restaura
Entonces 2 documentos quedan disponibles y el tercero sigue pendiente
  Y el resultado informa su identificador con el motivo suma distinta
```

## Notas

- Change: `add-document-attachments`. Requirement: "Archivo de contenidos de documentos del export" (`identity/workspace-portability`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
