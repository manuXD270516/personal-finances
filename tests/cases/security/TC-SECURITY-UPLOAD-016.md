---
id: TC-SECURITY-UPLOAD-016
title: "El objeto almacenado está cifrado y un byte alterado corta la descarga"
spec: security/file-upload-security
related_specs: []
requirement: "Contenido cifrado en reposo"
scenario: null
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-007"
nfr:
  - "NFR-SEC-006"
invariants: []
priority: critical
type: security
level: container-integration
automation_status: automated
automated_tests: ["apps/api/test/api/documents.api.test.ts", "apps/api/test/storage/object-storage.int.test.ts", "packages/contexts/documents/src/application/documents.service.test.ts", "packages/platform/src/crypto/envelope.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "encryption"
  - "integrity"
error_code: DOCUMENT_CONTENT_CORRUPTED
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "\"factura-luz-octubre.pdf\" AVAILABLE (482133 bytes, 8 bloques de 64 KiB)"
input:
  pasos:
    - "GetObject directo del bucket de documentos"
    - "modificar un byte del bloque 5 y descargar"
    - "copiar wrapped_key a otro documento y descargar"
steps:
  - "Leer el objeto sin la aplicación"
  - "Alterar y descargar"
  - "Probar el envoltorio copiado"
expected_result:
  - "El objeto no empieza con %PDF- ni contiene texto de la factura"
  - "Byte alterado ⇒ la descarga se corta sin emitir el bloque 5 ni siguientes (422 DOCUMENT_CONTENT_CORRUPTED si aún no se enviaron cabeceras)"
  - "Envoltorio copiado ⇒ DOCUMENT_CONTENT_CORRUPTED (AAD por documento)"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-016 — El objeto almacenado está cifrado y un byte alterado corta la descarga

## Intención

NFR-SEC-006 con el formato PFXE v1.

## Escenario

```gherkin
Dado "factura-luz-octubre.pdf" disponible
Cuando un byte del objeto cifrado se modifica y un miembro lo descarga
Entonces la descarga falla con "DOCUMENT_CONTENT_CORRUPTED"
  Y no se entregan bytes del bloque alterado ni de los siguientes
```

## Notas

- Change: `add-document-attachments`. Requirement: "Contenido cifrado en reposo" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
