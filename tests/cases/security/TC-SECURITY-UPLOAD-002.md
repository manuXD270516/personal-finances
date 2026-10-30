---
id: TC-SECURITY-UPLOAD-002
title: "Una extensión permitida con un tipo declarado que no le corresponde se rechaza"
spec: security/file-upload-security
related_specs: []
requirement: "Lista permitida de tipos de archivo"
scenario: "Extensión y tipo declarado que no corresponden"
requirement_status: confirmed
fr:
  - "FR-DOCUMENTS-002"
nfr:
  - "NFR-SEC-012"
invariants: []
priority: high
type: security
level: api
automation_status: automated
automated_tests: ["packages/contexts/documents/src/domain/file-policy.test.ts"]
status: automated
regression_suite: false
phase: 6
tags:
  - "upload"
  - "allowlist"
  - "malicious-suite"
error_code: UPLOAD_TYPE_NOT_ALLOWED
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  usuario: "editor"
  casos:
    - "extracto.pdf text/html"
    - "recibo.png application/pdf"
    - "datos.csv application/octet-stream"
steps:
  - "Solicitar la subida de cada caso"
expected_result:
  - "422 UPLOAD_TYPE_NOT_ALLOWED sin URL ni documento"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-002 — Una extensión permitida con un tipo declarado que no le corresponde se rechaza

## Intención

Caso 3 de la suite.

## Escenario

```gherkin
Cuando el EDITOR solicita subir "extracto.pdf" declarando "text/html"
Entonces la respuesta es 422 con "UPLOAD_TYPE_NOT_ALLOWED"
  Y no se entrega dirección de subida
```

## Notas

- Change: `add-document-attachments`. Requirement: "Lista permitida de tipos de archivo" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
