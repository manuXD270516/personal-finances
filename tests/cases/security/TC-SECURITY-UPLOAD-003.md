---
id: TC-SECURITY-UPLOAD-003
title: "Los máximos de 15 MiB y 20 MiB por propósito y el tope de 25 MiB se aplican"
spec: security/file-upload-security
related_specs: []
requirement: "Tamaño máximo por propósito"
scenario: null
requirement_status: provisional
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: critical
type: security
level: api
automation_status: not_automated
status: draft
regression_suite: false
phase: 6
tags:
  - "upload"
  - "size"
  - "malicious-suite"
error_code: UPLOAD_TOO_LARGE
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  usuario: "editor"
  casos:
    - "RECEIPT 15728641 bytes"
    - "RECEIPT 15728640 bytes"
    - "IMPORT_SOURCE 19922944 bytes"
    - "IMPORT_SOURCE 20971521 bytes"
    - "RECEIPT 0 bytes"
    - "arranque con DOCUMENT_MAX_BYTES=26214401"
steps:
  - "Solicitar cada subida"
  - "Arrancar la API con el máximo inválido"
expected_result:
  - "413 UPLOAD_TOO_LARGE para 15728641 y 20971521"
  - "201 para 15728640 y 19922944"
  - "400 VALIDATION_FAILED para 0 bytes"
  - "La API no arranca con un máximo mayor a 26214400"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-003 — Los máximos de 15 MiB y 20 MiB por propósito y el tope de 25 MiB se aplican

## Intención

Caso 4 de la suite y límites de la pregunta 5.

## Escenario

```gherkin
Cuando el EDITOR solicita subir un comprobante de 15728641 bytes
Entonces la respuesta es 413 con "UPLOAD_TOO_LARGE"
Y cuando solicita un extracto para importar de 19922944 bytes se registra pendiente de subida
```

## Notas

- Change: `add-document-attachments`. Requirement: "Tamaño máximo por propósito" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
