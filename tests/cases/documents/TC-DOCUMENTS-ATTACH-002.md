---
id: TC-DOCUMENTS-ATTACH-002
title: "Un VIEWER no puede solicitar subidas de documentos"
spec: documents/attachments
related_specs: []
requirement: "Solicitar la subida de un documento"
scenario: "Un VIEWER no puede subir"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-001"
nfr:
  - "NFR-SEC-003"
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "rbac"
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  usuario: "viewer"
  request: "POST /api/v1/workspaces/{W1}/documents/uploads"
  body:
    fileName: "recibo.png"
    contentType: "image/png"
    sizeBytes: 20480
    purpose: "RECEIPT"
steps:
  - "Enviar la solicitud"
  - "Contar los documentos de W1"
expected_result:
  - "403 INSUFFICIENT_ROLE"
  - "W1 sigue sin documentos y la respuesta no trae URL"
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-002 — Un VIEWER no puede solicitar subidas de documentos

## Intención

La matriz de docs/10 reserva subir y adjuntar a OWNER y EDITOR.

## Escenario

```gherkin
Dado que "viewer" es VIEWER de "W1"
Cuando solicita subir "recibo.png"
Entonces la respuesta es 403 con "INSUFFICIENT_ROLE"
  Y no se registra ningún documento
```

## Notas

- Change: `add-document-attachments`. Requirement: "Solicitar la subida de un documento" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
