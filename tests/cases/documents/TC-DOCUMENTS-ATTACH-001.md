---
id: TC-DOCUMENTS-ATTACH-001
title: "Solicitar la subida de un comprobante devuelve una URL atada a tamaño, tipo y suma"
spec: documents/attachments
related_specs: []
requirement: "Solicitar la subida de un documento"
scenario: "Solicitud de subida de un comprobante"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-001"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: api
level: api
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "packages/contexts/documents/src/application/uploads.service.test.ts", "packages/contexts/documents/src/domain/file-policy.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "documents"
  - "upload"
  - "presigned"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Reloj fijo 2026-10-29T10:00:00-04:00 (America/La_Paz)"
input:
  usuario: "editor"
  request: "POST /api/v1/workspaces/{W1}/documents/uploads"
  body:
    fileName: "factura-luz-octubre.pdf"
    contentType: "application/pdf"
    sizeBytes: 482133
    sha256: "<suma del fixture>"
    purpose: "RECEIPT"
steps:
  - "Enviar la solicitud con Idempotency-Key"
  - "Inspeccionar la URL firmada y el documento registrado"
expected_result:
  - "201 con document.status PENDING_UPLOAD, sizeBytes 482133 y purpose RECEIPT"
  - "upload.expiresAt = 2026-10-29T10:05:00-04:00"
  - "La URL firma content-type, content-length y x-amz-checksum-sha256 y apunta al bucket de cuarentena"
  - "La clave de objeto no contiene \"factura\""
created: 2026-10-29
updated: 2026-10-29
---

# TC-DOCUMENTS-ATTACH-001 — Solicitar la subida de un comprobante devuelve una URL atada a tamaño, tipo y suma

## Intención

La API registra la intención de subida y delega el binario al almacenamiento con condiciones firmadas (FR-DOCUMENTS-001, docs/12 §8.2).

## Escenario

```gherkin
Dado que "editor" es EDITOR de "W1"
Cuando solicita subir "factura-luz-octubre.pdf" de 482133 bytes con propósito comprobante
Entonces se registra un documento "pendiente de subida"
  Y la URL vence a los 5 minutos y exige 482133 bytes, "application/pdf" y la suma declarada
```

## Notas

- Change: `add-document-attachments`. Requirement: "Solicitar la subida de un documento" (`documents/attachments`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
