---
id: TC-SECURITY-UPLOAD-007
title: "Un políglota HTML/PDF y un SVG con script disfrazado se rechazan"
spec: security/file-upload-security
related_specs: []
requirement: "Tipo real por contenido"
scenario: "Políglota HTML y PDF"
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
  - "polyglot"
  - "malicious-suite"
error_code: null
preconditions:
  - "Minimal Seed: W1 con OWNER \"owner\", EDITOR \"editor\" y VIEWER \"viewer\"; W2 con OWNER \"owner\"; almacenamiento S3 local (SeaweedFS) con buckets de documentos y de cuarentena"
input:
  casos:
    - "estado.pdf: <html><script>…</script> y %PDF-1.7 en el byte 200"
    - "recibo.png image/png con un SVG con <script>"
steps:
  - "Subir y confirmar cada caso"
expected_result:
  - "Ambos REJECTED/TYPE_MISMATCH"
  - "Ninguno queda en cuarentena ni en el bucket de documentos"
created: 2026-10-29
updated: 2026-10-29
---

# TC-SECURITY-UPLOAD-007 — Un políglota HTML/PDF y un SVG con script disfrazado se rechazan

## Intención

Casos 9 y 10 de la suite; la firma PDF se exige en el byte 0.

## Escenario

```gherkin
Cuando se sube "estado.pdf" que empieza con HTML con un script y contiene una cabecera PDF más adelante
Entonces el documento queda "rechazado" con el motivo tipo distinto
```

## Notas

- Change: `add-document-attachments`. Requirement: "Tipo real por contenido" (`security/file-upload-security`).
- Datos sintéticos; ningún archivo real del owner (D255). Los fixtures peligrosos se generan por código y no se versionan.
