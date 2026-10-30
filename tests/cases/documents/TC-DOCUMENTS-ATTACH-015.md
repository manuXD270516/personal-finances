---
id: TC-DOCUMENTS-ATTACH-015
title: "Descargar un documento no disponible, rechazado o eliminado se rechaza sin contenido"
spec: documents/attachments
related_specs: []
requirement: "Descarga a través de la API"
scenario: "Descargar un documento eliminado"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-004"
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: automated
automated_tests: ["packages/contexts/documents/src/application/documents.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "download"
error_code: DOCUMENT_DELETED
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documentos de W1 en PENDING_UPLOAD, REJECTED, DELETED y CONTENT_PENDING"
input:
  usuario: "viewer"
  request: "GET …/documents/{id}/download para cada uno"
steps:
  - "Descargar cada documento"
expected_result:
  - "409 DOCUMENT_NOT_AVAILABLE (pendiente y contenido pendiente), 409 DOCUMENT_REJECTED, 410 DOCUMENT_DELETED"
  - "Ninguna respuesta lleva cuerpo binario"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-015 — Descargar un documento no disponible, rechazado o eliminado se rechaza sin contenido

## Intención

Cada estado no descargable tiene su código estable.

## Escenario

```gherkin
Dado un documento que el OWNER eliminó
Cuando un miembro lo descarga
Entonces la respuesta es 410 con "DOCUMENT_DELETED"
  Y no se entrega contenido
```

## Notas

- Change: `add-document-attachments`. Requirement: "Descarga a través de la API" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
