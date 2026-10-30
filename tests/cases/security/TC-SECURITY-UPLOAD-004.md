---
id: TC-SECURITY-UPLOAD-004
title: "El almacenamiento rechaza un contenido sustituido y nada queda disponible"
spec: security/file-upload-security
related_specs: []
requirement: "Integridad de la subida"
scenario: "Contenido sustituido"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: security
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/upload-security.api.test.ts", "apps/api/test/storage/object-storage.int.test.ts", "packages/contexts/documents/src/application/uploads.service.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "upload"
  - "integrity"
  - "malicious-suite"
error_code: DOCUMENT_UPLOAD_MISSING
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "Documento \"factura.pdf\" pendiente con 482133 bytes y suma S"
input:
  pasos:
    - "PUT de otros 482133 bytes a la URL firmada"
    - "PUT de 482134 bytes"
    - "PUT con Content-Type image/png"
    - "POST …/complete"
steps:
  - "Intentar cada PUT"
  - "Confirmar"
  - "Forzar con un adapter de prueba un HEAD con suma distinta y confirmar"
expected_result:
  - "Los tres PUT se rechazan (firma o checksum)"
  - "complete ⇒ 409 DOCUMENT_UPLOAD_MISSING y el documento sigue pendiente"
  - "Con suma distinta en el objeto ⇒ REJECTED/CHECKSUM_MISMATCH; con tamaño distinto ⇒ REJECTED/SIZE_MISMATCH"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-004 — El almacenamiento rechaza un contenido sustituido y nada queda disponible

## Intención

Caso 5 de la suite (checksum firmado, SPIKE-07).

## Escenario

```gherkin
Dado la URL de subida de "factura.pdf" con 482133 bytes y su suma
Cuando se envían otros 482133 bytes
Entonces el almacenamiento rechaza la subida
  Y al confirmar la respuesta es "DOCUMENT_UPLOAD_MISSING"
```

## Notas

- Change: `add-document-attachments`. Requirement: "Integridad de la subida" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
