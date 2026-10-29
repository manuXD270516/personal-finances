---
id: TC-DOCUMENTS-ATTACH-004
title: "Confirmar sin haber subido el archivo responde DOCUMENT_UPLOAD_MISSING"
spec: documents/attachments
related_specs: []
requirement: "Confirmar la subida y verificar el archivo"
scenario: "Confirmación sin haber subido"
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-001"
nfr: []
invariants: []
priority: high
type: api
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "documents"
  - "verification"
error_code: DOCUMENT_UPLOAD_MISSING
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documento pendiente de subida sin objeto en la cuarentena"
input:
  usuario: "editor"
  request: "POST /api/v1/workspaces/{W1}/documents/{id}/complete"
steps:
  - "Confirmar la subida"
  - "Consultar el documento"
expected_result:
  - "409 DOCUMENT_UPLOAD_MISSING"
  - "El documento sigue PENDING_UPLOAD"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-004 — Confirmar sin haber subido el archivo responde DOCUMENT_UPLOAD_MISSING

## Intención

Sin objeto no hay transición: el usuario puede subir y confirmar de nuevo mientras la URL esté vigente.

## Escenario

```gherkin
Dado un documento cuyo archivo nunca llegó al almacenamiento
Cuando el EDITOR confirma la subida
Entonces la respuesta es 409 con "DOCUMENT_UPLOAD_MISSING"
  Y el documento sigue "pendiente de subida"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Confirmar la subida y verificar el archivo" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
