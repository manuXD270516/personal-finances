---
id: TC-SECURITY-UPLOAD-001
title: "SVG, HTML, ejecutables, ZIP, XLSM y XLS se rechazan al solicitar la subida"
spec: security/file-upload-security
related_specs: []
requirement: "Lista permitida de tipos de archivo"
scenario: "Imagen SVG"
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
  - "allowlist"
  - "malicious-suite"
error_code: UPLOAD_TYPE_NOT_ALLOWED
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  usuario: "editor"
  casos:
    - "logo.svg image/svg+xml"
    - "pagina.html text/html"
    - "setup.exe application/x-msdownload"
    - "fotos.zip application/zip"
    - "libro.xlsm application/vnd.ms-excel.sheet.macroEnabled.12"
    - "libro.xls application/vnd.ms-excel"
steps:
  - "Solicitar la subida de cada caso"
  - "Contar documentos y URLs emitidas"
expected_result:
  - "422 UPLOAD_TYPE_NOT_ALLOWED en los 6 casos"
  - "0 documentos registrados y 0 URLs"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-001 — SVG, HTML, ejecutables, ZIP, XLSM y XLS se rechazan al solicitar la subida

## Intención

Casos 1 y 2 de la suite (design.md § Suite).

## Escenario

```gherkin
Dado el EDITOR de "W1"
Cuando solicita subir "logo.svg" de tipo "image/svg+xml"
Entonces la respuesta es 422 con "UPLOAD_TYPE_NOT_ALLOWED"
  Y no se registra ningún documento
```

## Notas

- Change: `add-document-attachments`. Requirement: "Lista permitida de tipos de archivo" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
