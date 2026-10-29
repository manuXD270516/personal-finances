---
id: TC-DOCUMENTS-ATTACH-018
title: "La purga elimina documentos sin vínculo de más de 30 días salvo los archivados"
spec: documents/attachments
related_specs: []
requirement: "Purga de documentos sin vínculo"
scenario: "Documento huérfano de 31 días"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-007"
nfr:
  - "NFR-COMP-005"
invariants: []
priority: medium
type: integration
level: repository-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "retention"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "\"borrador.pdf\" AVAILABLE sin vínculos desde 2026-09-28"
  - "\"plantilla.pdf\" archivado sin vínculos desde 2026-09-28"
  - "\"factura.pdf\" vinculado desde 2026-09-01"
  - "Reloj fijo 2026-10-29"
input:
  job: "PurgeUnlinkedDocuments"
steps:
  - "Ejecutar la purga"
  - "Consultar los tres documentos y la auditoría"
expected_result:
  - "\"borrador.pdf\" DELETED con actor SYSTEM (documents.document.purged)"
  - "\"plantilla.pdf\" y \"factura.pdf\" siguen AVAILABLE"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-018 — La purga elimina documentos sin vínculo de más de 30 días salvo los archivados

## Intención

FR-DOCUMENTS-007 con archivado como excepción (pregunta 6).

## Escenario

```gherkin
Dado "borrador.pdf" sin vínculos ni archivado desde el 2026-09-28
Cuando el mantenimiento corre el 2026-10-29
Entonces "borrador.pdf" queda "eliminado" con actor sistema
  Y un documento archivado sin vínculos sigue disponible
```

## Notas

- Change: `add-document-attachments`. Requirement: "Purga de documentos sin vínculo" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
