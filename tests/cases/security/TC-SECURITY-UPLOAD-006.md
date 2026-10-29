---
id: TC-SECURITY-UPLOAD-006
title: "Un PNG como PDF y un ejecutable como CSV quedan rechazados por su contenido"
spec: security/file-upload-security
related_specs: []
requirement: "Tipo real por contenido"
scenario: null
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: security
level: container-integration
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "upload"
  - "magic-bytes"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  casos:
    - "factura.pdf application/pdf con contenido PNG"
    - "extracto.csv text/csv con cabecera MZ (PE)"
    - "recibo.jpg image/jpeg con contenido ELF"
steps:
  - "Solicitar, subir y confirmar cada caso"
  - "Intentar descargar y adjuntar cada documento"
expected_result:
  - "factura.pdf ⇒ REJECTED/TYPE_MISMATCH"
  - "extracto.csv ⇒ REJECTED/MALFORMED_CONTENT"
  - "recibo.jpg ⇒ REJECTED/TYPE_MISMATCH"
  - "Descargar y adjuntar ⇒ DOCUMENT_REJECTED"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-006 — Un PNG como PDF y un ejecutable como CSV quedan rechazados por su contenido

## Intención

Casos 7 y 8 de la suite.

## Escenario

```gherkin
Cuando se sube y confirma "factura.pdf" cuyo contenido es una imagen PNG
Entonces el documento queda "rechazado" con el motivo tipo distinto
```

## Notas

- Change: `add-document-attachments`. Requirement: "Tipo real por contenido" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
