---
id: TC-SECURITY-UPLOAD-017
title: "La rotación vuelve a envolver las claves y no se puede retirar una clave en uso"
spec: security/file-upload-security
related_specs: []
requirement: "Rotación de la clave maestra de documentos"
scenario: null
requirement_status: confirmed
fr: []
nfr:
  - "NFR-SEC-006"
invariants: []
priority: medium
type: security
level: container-integration
automation_status: automated
automated_tests: ["packages/contexts/documents/src/application/documents.service.test.ts", "packages/contexts/documents/src/application/uploads.service.test.ts", "packages/contexts/documents/src/domain/document.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "encryption"
  - "key-rotation"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
  - "40 documentos envueltos con \"k1\""
input:
  pasos:
    - "activar \"k2\""
    - "ejecutar RewrapDocumentKeys"
    - "arrancar sin \"k1\" antes y después de la rotación"
steps:
  - "Activar k2 y subir un documento nuevo"
  - "Ejecutar el mantenimiento"
  - "Descargar los 40 y comparar sumas"
  - "Arrancar sin k1"
expected_result:
  - "El documento nuevo usa k2"
  - "Los 40 quedan con key_id k2, contenido sin re-cifrar (mismo objeto y versión) y sumas originales"
  - "Sin k1 antes de rotar: el arranque falla nombrando \"k1\"; después de rotar arranca"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-017 — La rotación vuelve a envolver las claves y no se puede retirar una clave en uso

## Intención

Rotación sin re-cifrado (design.md decisión 6).

## Escenario

```gherkin
Dado 40 documentos envueltos con "k1"
Cuando se activa "k2" y corre el mantenimiento
Entonces los 40 quedan envueltos con "k2" y siguen descargables con su suma original
```

## Notas

- Change: `add-document-attachments`. Requirement: "Rotación de la clave maestra de documentos" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
